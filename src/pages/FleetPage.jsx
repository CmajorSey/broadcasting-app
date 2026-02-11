import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import { Input } from "@/components/ui/input";
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

// Single flag to control ALL edits on this page
const canEdit = isAdmin || isDriver;

// ---------------- Notifications (match notifications.json schema) ----------------
const sendFleetNotification = async ({ title, message, urgent = false }) => {
  try {
    const actor = loggedInUser?.name || "Unknown";

    /**
     * ✅ RECIPIENT STRATEGY (SAFE + GLOBAL)
     * - Actor (so they get a toast confirmation)
     * - ALL Drivers (driver + driver_limited) via role buckets
     * - ALL Admins via role buckets
     *
     * App.jsx will decide:
     * - actor === loggedInUser → toast only, no sound
     * - others → toast + sound (if enabled)
     */
    const recipients = [
      actor,

      // Driver buckets
      "Drivers",
      "drivers",
      "driver",
      "driver_limited",

      // Admin buckets
      "Admins",
      "admins",
      "admin",
    ];

    const payload = {
      title,
      message,
      recipients,
      timestamp: new Date().toISOString(),
      category: "fleet",
      urgent: !!urgent,

      // ✅ lets App.jsx apply global “self = no sound” rule
      actor,
    };

    // 1) ✅ Always write to your backend notification feed (existing behavior)
    await fetch(`${API_BASE}/notifications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // 2) ✅ ALSO attempt PUSH (non-blocking, safe fallback)
    //    - Uses the same recipients list
    //    - Tries common endpoints; ignores failures so Fleet never breaks
    const pushBody = {
      title,
      body: message,
      message,
      recipients, // allow backend to resolve roles -> users -> tokens
      category: "fleet",
      urgent: !!urgent,
      actor,
      data: {
        category: "fleet",
        urgent: !!urgent,
        actor,
      },
    };

    const tryPush = async (url) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pushBody),
        });
        return !!res?.ok;
      } catch {
        return false;
      }
    };

    // Try a few likely push routes (first one that exists will work)
    // NOTE: If none exist yet, this does nothing (still safe).
    const ok =
      (await tryPush(`${API_BASE}/push`)) ||
      (await tryPush(`${API_BASE}/push/send`)) ||
      (await tryPush(`${API_BASE}/notifications/push`));

    if (!ok && import.meta.env.DEV) {
      console.warn(
        "Fleet push not sent (no push endpoint matched). Feed/toasts still OK."
      );
    }
  } catch (err) {
    // Never break Fleet if notifications fail
    console.warn("Fleet notification failed (non-blocking):", err);
  }
};

  // ---------------- Helpers (rental/dates) ----------------
  const fmtShort = (dateLike) => {
    if (!dateLike) return "";
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // diff in whole days using local midnight boundaries
  const daysBetween = (fromDate, toDate) => {
    const a = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
    const b = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  };

  const isRentalVehicle = (v) =>
    v?.permanent === false ||
    v?.status === "Rental" ||
    v?.type === "Rental" ||
    !!(v?.rentStartISO && v?.rentEndISO);

  const rentalInfo = (v) => {
    if (!v?.rentStartISO || !v?.rentEndISO) return null;
    const start = new Date(v.rentStartISO);
    const end = new Date(v.rentEndISO);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

    const today = new Date();
    const inclusiveDays = daysBetween(start, end) + 1; // 21→24 = 4 days
    const daysLeft = daysBetween(today, end); // 1: tomorrow, 0: today, -1: yesterday

    let status = "";
    if (daysLeft > 1) status = `${daysLeft} days left`;
    else if (daysLeft === 1) status = "Ends tomorrow";
    else if (daysLeft === 0) status = "Ends today";
    else status = "Expired";

    return {
      label: `Rental • ${fmtShort(start)} → ${fmtShort(end)} (${inclusiveDays} days) • ${status}`,
      daysLeft,
      startISO: v.rentStartISO,
      endISO: v.rentEndISO,
    };
  };

   // ---------------- State ----------------
  const [noteOptions, setNoteOptions] = useState([
    "Cleaned and Fueled",
    "Needs Cleaning",
    "Low on Fuel",
    "Maintenance Scheduled",
    "Ready for Use",
    "Issue Reported",
  ]);

  const [selectedIds, setSelectedIds] = useState([]);
  const [openDropdownId, setOpenDropdownId] = useState(null);

  const [noteToDelete, setNoteToDelete] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /* ===========================
     🧾 Fleet dialogs state starts
     (replaces prompt/confirm/alert)
     =========================== */
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const [customNoteOpen, setCustomNoteOpen] = useState(false);
  const [customNoteVehicleId, setCustomNoteVehicleId] = useState(null);
  const [customNoteValue, setCustomNoteValue] = useState("");

  const [createErrorOpen, setCreateErrorOpen] = useState(false);
  const [createErrorMessage, setCreateErrorMessage] = useState("");
  /* ===========================
     🧾 Fleet dialogs state end
     =========================== */

  const [newVehicle, setNewVehicle] = useState({
    name: "",
    status: "Available",
    insuranceExpiry: "",
    patentExpiry: "",
    licensePlate: "",
    permanent: true, // default permanent
    rentStartISO: "",
    rentEndISO: "",
  });

  // ---------------- Shared handlers (existing preserved) ----------------
 const handleStatusChange = async (id, newStatus) => {
  if (!canEdit) return;

  const before = vehicles.find((v) => v.id === id);

  const updated = vehicles.map((v) =>
    v.id === id ? { ...v, status: newStatus } : v
  );
  setVehicles(updated);

  try {
    const updatedVehicle = updated.find((v) => v.id === id);
    const res = await fetch(`${API_BASE}/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedVehicle),
    });

    if (!res.ok) throw new Error("Failed to update vehicle status");

    const name = updatedVehicle?.name || "Vehicle";
    await sendFleetNotification({
      title: "Fleet updated",
      message: `${name} status changed: ${before?.status || "Unknown"} → ${newStatus}`,
      urgent: newStatus === "Issue Reported",
    });
  } catch (err) {
    console.error("Failed to update vehicle status:", err);
  }
};


 const handleNoteSelect = async (id, note) => {
  if (!canEdit) return;

  const before = vehicles.find((v) => v.id === id);

  const updated = vehicles.map((v) =>
    v.id === id ? { ...v, notes: note } : v
  );
  setVehicles(updated);
  setOpenDropdownId(null);

  try {
    const updatedVehicle = updated.find((v) => v.id === id);
    const res = await fetch(`${API_BASE}/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedVehicle),
    });

    if (!res.ok) throw new Error("Failed to update note");

    const name = updatedVehicle?.name || "Vehicle";
    await sendFleetNotification({
      title: "Fleet note updated",
      message: `${name} note changed: ${before?.notes || "No note"} → ${note}`,
      urgent: false,
    });
  } catch (err) {
    console.error("Failed to update note:", err);
  }
};

 const handleDeleteNote = async (id) => {
  if (!canEdit) return;

  const before = vehicles.find((v) => v.id === id);

  const updated = vehicles.map((v) =>
    v.id === id ? { ...v, notes: "" } : v
  );
  setVehicles(updated);
  setOpenDropdownId(null);

  try {
    const updatedVehicle = updated.find((v) => v.id === id);
    const res = await fetch(`${API_BASE}/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedVehicle),
    });

    if (!res.ok) throw new Error("Failed to delete note");

    const name = updatedVehicle?.name || "Vehicle";
    await sendFleetNotification({
      title: "Fleet note cleared",
      message: `${name} note cleared (was: ${before?.notes || "No note"})`,
      urgent: false,
    });
  } catch (err) {
    console.error("Failed to delete note:", err);
  }
};

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

  /* ===========================
     📝 Custom note flow starts here
     (replaces browser prompt)
     =========================== */
  const handleCustomNote = async (id) => {
    if (!canEdit) return;

    const existing = vehicles.find((v) => v.id === id)?.notes || "";
    setCustomNoteVehicleId(id);
    setCustomNoteValue(existing);
    setCustomNoteOpen(true);
  };

  const confirmSaveCustomNote = async () => {
    if (!canEdit) return;
    if (!customNoteVehicleId) return;

    const id = customNoteVehicleId;
    const before = vehicles.find((v) => v.id === id);

    const note = String(customNoteValue || "").trim();
    if (!note) {
      setCustomNoteOpen(false);
      setCustomNoteVehicleId(null);
      setCustomNoteValue("");
      return;
    }

    const updated = vehicles.map((v) => (v.id === id ? { ...v, notes: note } : v));
    setVehicles(updated);
    setOpenDropdownId(null);

    try {
      const updatedVehicle = updated.find((v) => v.id === id);

      const res = await fetch(`${API_BASE}/vehicles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedVehicle),
      });

      if (!res.ok) throw new Error("Failed to save custom note");

      const name = updatedVehicle?.name || "Vehicle";
      await sendFleetNotification({
        title: "Fleet note updated",
        message: `${name} note changed: ${before?.notes || "No note"} → ${note}`,
        urgent: false,
      });
    } catch (err) {
      console.error("Failed to save custom note:", err);
    } finally {
      setCustomNoteOpen(false);
      setCustomNoteVehicleId(null);
      setCustomNoteValue("");
    }
  };
  /* ===========================
     📝 Custom note flow end
     =========================== */


   const handleDateChange = async (id, field, value) => {
  if (!canEdit) return;

  try {
    const updatedVehicle = vehicles.find((v) => v.id === id);
    if (!updatedVehicle) return;

    const beforeValue = updatedVehicle?.[field] || "";

    const updated = { ...updatedVehicle, [field]: value };

    const res = await fetch(`${API_BASE}/vehicles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });

    if (!res.ok) throw new Error("Failed to update vehicle");

    const newList = vehicles.map((v) => (v.id === id ? updated : v));
    setVehicles(newList);

    const name = updated?.name || "Vehicle";

    // urgency only for near-due key docs
    const isDocExpiry = field === "insuranceExpiry" || field === "patentExpiry";
    const urgent = isDocExpiry ? !!getWarning(value, field === "insuranceExpiry" ? "Insurance" : "Patent") : false;

    await sendFleetNotification({
      title: "Fleet date updated",
      message: `${name} ${field} changed: ${beforeValue || "Not set"} → ${value || "Cleared"}`,
      urgent,
    });
  } catch (err) {
    console.error("Error updating vehicle date:", err);
  }
};

  // Snooze rental end by +1 day
  const handleSnoozeRental = async (id) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v?.rentEndISO) return;
    const end = new Date(v.rentEndISO);
    end.setDate(end.getDate() + 1);
    const value = end.toISOString().split("T")[0];
    await handleDateChange(id, "rentEndISO", value);
  };

  // Clear rental dates (keeps vehicle, resets to permanent if permanent flag is true)
  const handleClearRental = async (id) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    const patch = { rentStartISO: "", rentEndISO: "" };
    try {
      await fetch(`${API_BASE}/vehicles/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setVehicles((prev) =>
        prev.map((x) => (x.id === id ? { ...x, ...patch } : x))
      );
    } catch (e) {
      console.error("Failed to clear rental dates:", e);
    }
  };

  // Single delete (used by “Delete Today” chip)
   const handleDeleteOne = async (id) => {
    const before = vehicles.find((v) => v.id === id);

    try {
      const res = await fetch(`${API_BASE}/vehicles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete vehicle");

      setVehicles((prev) => prev.filter((v) => v.id !== id));

      await sendFleetNotification({
        title: "Vehicle removed",
        message: `${before?.name || "Vehicle"} was deleted from Fleet.`,
        urgent: true,
      });
    } catch (e) {
      console.error("Failed to delete vehicle:", e);
    }
  };

  // ---------------- Effects ----------------
  useEffect(() => {
    const handleClickOutside = (event) => {
      const openDropdown = document.querySelector(
        `[data-dropdown-id='${openDropdownId}']`
      );
      if (openDropdown && !openDropdown.contains(event.target)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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

  // ---------------- UI ----------------
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Fleet Management</h1>
      </div>

      {canEdit && (
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
                onClick={() => setSelectedIds(vehicles.map((v) => v.id))}
                className="px-3 py-1 bg-blue-100 text-blue-800 rounded"
              >
                Select All
              </button>
            )}
          </div>

                 {selectedIds.length > 0 && (
            <button
              onClick={() => {
                if (!canEdit) return;
                setBulkDeleteOpen(true);
              }}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
            >
              🗑️ Delete Selected ({selectedIds.length})
            </button>
          )}
        </div>
      )}

      <ul className="space-y-4">
        {vehicles.map((v) => {
          const r = rentalInfo(v);
          const rental = isRentalVehicle(v);
          const showLastDayChips = r && (r.daysLeft === 0 || r.daysLeft === -1);

          return (
            <li
              key={v.id}
              className={`bg-white p-4 shadow rounded border space-y-2 relative z-0 ${
                rental ? "border-green-500" : "border-gray-200"
              }`}
            >
              {canEdit && (
                <input
                  type="checkbox"
                  className="absolute top-2 right-2"
                  checked={selectedIds.includes(v.id)}
                  onChange={() => {
                    setSelectedIds((prev) =>
                      prev.includes(v.id)
                        ? prev.filter((x) => x !== v.id)
                        : [...prev, v.id]
                    );
                  }}
                />
              )}

              <div className="flex justify-between items-start sm:items-center flex-col sm:flex-row">
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg">{v.name}</span>
                    {canEdit ? (
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

                  {rental && (
                    <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800">
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

              {/* Rental line */}
              {r && (
                <div className="text-sm text-gray-700">
                  {r.label}
                  {showLastDayChips && (isAdmin || isDriver) && (
                    <span className="ml-2 inline-flex gap-2">
                      <button
                        onClick={() => handleDeleteOne(v.id)}
                        className="text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded px-2 py-0.5 text-xs"
                        title="Remove this rental vehicle today"
                      >
                        Delete Today
                      </button>
                      <button
                        onClick={() => handleSnoozeRental(v.id)}
                        className="text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded px-2 py-0.5 text-xs"
                        title="Extend rental by one day"
                      >
                        Snooze 1 day
                      </button>
                      <button
                        onClick={() => handleClearRental(v.id)}
                        className="text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded px-2 py-0.5 text-xs"
                        title="Clear rental dates (keep vehicle)"
                      >
                        Clear dates
                      </button>
                    </span>
                  )}
                </div>
              )}

                          <p className="text-sm text-gray-600">
                  <strong>Note:</strong> {v.notes || "No notes"}
                </p>


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
                      <option value="Not To Be Used">Not To Be Used</option>
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

                  {/* Expiry Dates (kept) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                    <div>
                      <label className="block text-sm font-semibold">Insurance Expiry</label>
                      <input
                        type="date"
                        value={v.insuranceExpiry || ""}
                        onChange={(e) =>
                          handleDateChange(v.id, "insuranceExpiry", e.target.value)
                        }
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
                        onChange={(e) =>
                          handleDateChange(v.id, "patentExpiry", e.target.value)
                        }
                        className="border rounded p-2 w-full"
                      />
                      {v.patentExpiry && (
                        <span className={`text-xs ${getExpiryColor(v.patentExpiry)}`}>
                          Expires {new Date(v.patentExpiry).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Rental Dates (edit inline, visible when rental) */}
                  {rental && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                      <div>
                        <label className="block text-sm font-semibold">Rent Start</label>
                        <input
                          type="date"
                          value={v.rentStartISO || ""}
                          onChange={(e) => handleDateChange(v.id, "rentStartISO", e.target.value)}
                          className="border rounded p-2 w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold">Rent End</label>
                        <input
                          type="date"
                          value={v.rentEndISO || ""}
                          onChange={(e) => handleDateChange(v.id, "rentEndISO", e.target.value)}
                          className="border rounded p-2 w-full"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {/* Warnings (kept) */}
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
          );
        })}
      </ul>

      {/* Create Vehicle Button and Modal for Admins and Full Drivers */}
      {canEdit && (
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
                      <label className="block text-sm font-semibold mb-1">
                        Insurance Expiry
                      </label>
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
                      <label className="block text-sm font-semibold mb-1">
                        Patent Expiry
                      </label>
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
                            // if switching to Permanent, clear rental dates in the form
                            ...(e.target.value === "Permanent"
                              ? { rentStartISO: "", rentEndISO: "" }
                              : {}),
                          }))
                        }
                      >
                        <option value="Permanent">Permanent</option>
                        <option value="Rental">Rental</option>
                      </select>
                    </div>
                  </div>

                  {/* Rental Period (only when Type = Rental) */}
                  {!newVehicle.permanent && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-sm font-semibold mb-1">
                          Rent Start
                        </label>
                        <input
                          type="date"
                          className="w-full border rounded p-2"
                          value={newVehicle.rentStartISO}
                          onChange={(e) =>
                            setNewVehicle((prev) => ({
                              ...prev,
                              rentStartISO: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold mb-1">
                          Rent End
                        </label>
                        <input
                          type="date"
                          className="w-full border rounded p-2"
                          value={newVehicle.rentEndISO}
                          onChange={(e) =>
                            setNewVehicle((prev) => ({
                              ...prev,
                              rentEndISO: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      if (!newVehicle.name.trim()) return;

                      try {
                        const payload = {
                          ...newVehicle,
                          name: newVehicle.name.trim(),
                          notes: "",
                          licensePlate: newVehicle.licensePlate?.trim() || "",
                        };

                        // If Permanent, drop rental dates from payload to keep storage clean
                        if (payload.permanent) {
                          delete payload.rentStartISO;
                          delete payload.rentEndISO;
                        }

                                             const res = await fetch(`${API_BASE}/vehicles`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(payload),
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
                            permanent: true,
                            rentStartISO: "",
                            rentEndISO: "",
                          });

                          await sendFleetNotification({
                            title: "New vehicle added",
                            message: `${created?.name || payload.name} was added to Fleet${
                              created?.licensePlate ? ` (${created.licensePlate})` : ""
                            }.`,
                            urgent: false,
                          });
                        } else {
                          setCreateErrorMessage("Failed to create vehicle.");
                          setCreateErrorOpen(true);
                        }
                      } catch (err) {
                        console.error("Error:", err);
                        setCreateErrorMessage("Network error. Please try again.");
                        setCreateErrorOpen(true);
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

          {/* ===========================
          🧾 Fleet dialogs UI starts
          =========================== */}

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected vehicles?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedIds.length} vehicle(s) from Fleet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!canEdit) return;

                const ids = [...selectedIds];
                const beforeCount = ids.length;

                const remaining = [...vehicles];
                for (const id of ids) {
                  try {
                    await fetch(`${API_BASE}/vehicles/${id}`, { method: "DELETE" });
                    const idx = remaining.findIndex((v) => v.id === id);
                    if (idx !== -1) remaining.splice(idx, 1);
                  } catch (err) {
                    console.error(`Failed to delete vehicle ${id}:`, err);
                  }
                }

                setVehicles(remaining);
                setSelectedIds([]);
                setBulkDeleteOpen(false);

                // Optional: notify drivers/admins that a cleanup happened
                await sendFleetNotification({
                  title: "Fleet updated",
                  message: `${beforeCount} vehicle(s) were deleted from Fleet.`,
                  urgent: true,
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custom Note Dialog */}
      <AlertDialog open={customNoteOpen} onOpenChange={setCustomNoteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create Custom Note</AlertDialogTitle>
            <AlertDialogDescription>
              Type a custom note for this vehicle.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Input
              value={customNoteValue}
              onChange={(e) => setCustomNoteValue(e.target.value)}
              placeholder="Enter note..."
            />
            <p className="text-xs text-gray-500">
              Tip: keep it short (e.g. “Needs washing”, “Fuel half tank”, “Service booked”).
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setCustomNoteOpen(false);
                setCustomNoteVehicleId(null);
                setCustomNoteValue("");
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmSaveCustomNote}>
              Save Note
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create Vehicle Error Dialog */}
      <AlertDialog open={createErrorOpen} onOpenChange={setCreateErrorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Couldn’t create vehicle</AlertDialogTitle>
            <AlertDialogDescription>
              {createErrorMessage || "Something went wrong."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setCreateErrorOpen(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Note Confirmation Dialog (kept) */}
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
              <AlertDialogCancel onClick={cancelDeleteNoteOption}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={confirmDeleteNoteOption}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* ===========================
          🧾 Fleet dialogs UI end
          =========================== */}
    </div>
  );
}

