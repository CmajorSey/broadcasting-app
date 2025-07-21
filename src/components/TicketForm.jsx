import { useState, useEffect } from "react";
import { AlertTriangle, RadioTower, FileText } from 'lucide-react';
import DynamicDropdown from "./DynamicDropdown";
import StatusBadge from "./StatusBadge";
import AssignmentBadge from "./AssignmentBadge";
import DatePicker from "react-datepicker";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";

const rolePermissions = {
  journalist: {
    canAssignCamOps: true, // fallback only
    canEditAll: false,
    canAssignDrivers: false,
    canAddGear: false,
     canAddNotes: true,
    canAssignVehicle: false,
    canViewAllTickets: false,
  },
  producer: {
    canAssignCamOps: true,
    canEditAll: false,
    canAssignDrivers: false,
    canAddGear: false,
     canAddNotes: true,
    canAssignVehicle: false,
    canViewAllTickets: false,
  },
  admin: {
    canAssignCamOps: true,
    canEditAll: true,
    canAssignDrivers: true,
    canAddGear: true,
    canAddNotes: true,
    canAssignVehicle: true,
    canViewAllTickets: true,
  },
  camOp: {
    canAssignCamOps: false,
    canEditAll: false,
    canAssignDrivers: false,
    canAddGear: true,
    canAddNotes: true,
    canAssignVehicle: false,
    canViewAllTickets: true,
  },
  driver: {
    canAssignCamOps: false,
    canEditAll: false,
    canAssignDrivers: false,
    canAddGear: false,
    canAddNotes: false,
    canAssignVehicle: true,
    canViewAllTickets: true,
  },
};
function getDefaultShootType(role, type) {
  if (role === "producer") return "Production";
  if (role === "sports_journalist") return "ENG";
  if (role === "journalist") return "ENG";
  if (role === "admin") {
    if (type === "Production") return "Production";
    if (type === "News" || type === "Sports") return "ENG";
  }
  return "";
}

function getInitialFormData(loggedInUser) {
  const now = new Date();
  const userRoles = loggedInUser?.roles?.map((r) => r.toLowerCase()) || [];
let detectedRole = "journalist"; // fallback

if (userRoles.includes("producer")) {
  detectedRole = "producer";
} else if (userRoles.includes("admin")) {
  detectedRole = "admin";
} else if (
  loggedInUser?.description?.toLowerCase().includes("sport")
) {
  detectedRole = "sports_journalist";
}
let defaultType = "";
if (detectedRole === "producer") defaultType = "Production";
else if (detectedRole === "sports_journalist") defaultType = "Sports";
else if (detectedRole === "journalist") defaultType = "News";
else if (detectedRole === "admin") defaultType = "News";

const defaultShoot = getDefaultShootType(detectedRole, defaultType);

  now.setSeconds(0);
  now.setMilliseconds(0);
  now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5);
  const offset = now.getTimezoneOffset();
  now.setMinutes(now.getMinutes() - offset);
  const isoDate = now.toISOString().slice(0, 16);

  const departureTime = new Date();
  departureTime.setMinutes(Math.ceil(departureTime.getMinutes() / 5) * 5);
  const departureStr = departureTime.toTimeString().slice(0, 5);

  return {
    title: "",
    type: defaultType,
    category: "",
    subtype: "",
    date: isoDate,
    location: "",
    priority: "Normal",
    camOp: true,
    shootType: defaultShoot,
    notes: "",
    camCount: 1,
    onlyOneCamOp: true,
    camAssignments: {
      cam1: "",
      cam2: "",
      cam3: "",
    },
    departureTime: departureStr,
    filmingTime: departureStr,
     assignedCamOps: [],
    assignedDriver: "",
    vehicle: "",
    assignmentStatus: "Unassigned",
    isReady: false,
    status: "Pending", // ✅ added here
  };
}

function TicketForm({ users = [], loggedInUser, tickets = [], setTickets, vehicles = [], showRecent = false }) {
  const navigate = useNavigate();
  console.log("Current logged in user:", loggedInUser);
 const [formData, setFormData] = useState(getInitialFormData(loggedInUser));
  const [selectedDate, setSelectedDate] = useState(
  formData.date ? new Date(formData.date) : new Date()
);
  const [jobTypes, setJobTypes] = useState(["News", "Sports", "Production"]);
  const [newsCategories, setNewsCategories] = useState(["Press Conference", "Interview"]);
  const [sportsCategories, setSportsCategories] = useState(["Football", "Basketball", "Training", "Match"]);
    const [showNewsDropdown, setShowNewsDropdown] = useState(false);
  const [showSportsDropdown, setShowSportsDropdown] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
const [filterPriority, setFilterPriority] = useState("");
const [filterShootType, setFilterShootType] = useState("");
// Load rosters from localStorage
const [selectedRosterDay, setSelectedRosterDay] = useState(null);
const [camOpStatuses, setCamOpStatuses] = useState({});

useEffect(() => {
  const selectedDateIso = formData.date?.split("T")[0];
  if (!selectedDateIso) {
    setSelectedRosterDay(null);
    setCamOpStatuses({});
    return;
  }

  const getWeekStart = (dateStr) => {
    const date = new Date(dateStr);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date.toISOString().split("T")[0];
  };

  const weekStart = getWeekStart(selectedDateIso);

  fetch(`${API_BASE}/rosters/${weekStart}`)
    .then((res) => res.json())
    .then((week) => {
      const found = week.find((day) => day.date === selectedDateIso);
      setSelectedRosterDay(found || null);

      const statusMap = {};
      if (found) {
        for (const name of found.off || []) statusMap[name] = "Off Duty";
        for (const name of found.afternoonShift || []) statusMap[name] = "Afternoon Shift";
        for (const name of found.primary || []) statusMap[name] = "Primary Duty";
        for (const name of found.backup || []) statusMap[name] = "Backup Duty";
        for (const name of found.otherOnDuty || []) statusMap[name] = "Other Duty";
      }
      setCamOpStatuses(statusMap);
    })
    .catch((err) => {
      console.error("❌ Failed to fetch roster:", err);
      setSelectedRosterDay(null);
      setCamOpStatuses({});
    });
}, [formData.date]);
const can = (permission) => {
  if (!loggedInUser?.roles) return false;
  // If any of the user's roles grants the permission, return true
  return loggedInUser.roles.some((role) => rolePermissions[role]?.[permission]);
};
const [isCustomCamCount, setIsCustomCamCount] = useState(false);
const filteredTickets = tickets.filter((ticket) => {
  const matchesSearch = [
    ticket.title,
    ticket.location,
    ticket.type,
    ticket.category,
    ticket.subtype,
  ]
    .join(" ")
    .toLowerCase()
    .includes(searchQuery.toLowerCase());

  const matchesPriority = filterPriority ? ticket.priority === filterPriority : true;
  const matchesShootType = filterShootType ? ticket.shootType === filterShootType : true;

  return matchesSearch && matchesPriority && matchesShootType;
});
// Build cam ops lists with final ordering
const groupOne = []; // camOp without producer
const groupTwo = []; // camOp + producer
const groupThree = []; // Clive and Gilmer always last

const specialNames = ["gilmer philoe", "clive camille"];

users.forEach((user) => {
  const name = user.name;
  const lowerName = name.toLowerCase();
  const roles = Array.isArray(user.roles)
    ? user.roles.map((r) => r.toLowerCase())
    : [user.role?.toLowerCase()];

  if (specialNames.includes(lowerName)) {
    groupThree.push(name);
  } else if (roles.includes("camop")) {
    if (roles.includes("producer")) {
      groupTwo.push(name);
    } else {
      groupOne.push(name);
    }
  }
});

// Sort alphabetically
groupOne.sort();
groupTwo.sort();
groupThree.sort();

// Final array with a marker for separation
const camOperatorsSections = [
  { label: "CamOps (No Producer)", options: groupOne },
  { label: "CamOps + Producer", options: groupTwo },
  { label: "Senior CamOps", options: groupThree },
];
console.log("✅ Cam operators sections:", camOperatorsSections);
console.log("✅ All users data:", users);

 const handleChange = (e) => {
  const { name, value, type, checked } = e.target;
  setFormData((prev) => ({
    ...prev,
    [name]: type === "checkbox" ? checked : value,
  }));
};
const handleSubmit = async (e) => {
  e.preventDefault();

  const filmingTimeFromDate = formData.date
    ? formData.date.split("T")[1]?.slice(0, 5)
    : "";
  const name = loggedInUser?.name || "Unknown";

 const newTicket = {
  ...formData,
  filmingTime: formData.filmingTime || filmingTimeFromDate || "",
  status: "Pending",
  assignedCamOps: formData.assignedCamOps || [],
  assignedDriver: formData.assignedDriver || "",
  vehicle: formData.vehicle || "",
  vehicleStatus: "",
  assignmentStatus: "Unassigned",
  isReady: false,
  assignedReporter: formData.assignedReporter || `${loggedInUser?.description || "Journalist"} ${name}`,
  notes: formData.notes
    ? [
        {
          text: formData.notes.trim(),
          author: name,
          timestamp: new Date().toLocaleString(),
        },
      ]
    : [],
  createdBy: name,
  createdAt: new Date().toISOString(),
};

  try {
    const res = await fetch(`${API_BASE}/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTicket),
    });

    if (!res.ok) throw new Error("Failed to submit ticket");

    const savedTicket = await res.json();

    const updatedTickets = [savedTicket, ...tickets];
    setTickets(updatedTickets);
    setFormData(getInitialFormData());
    console.log("✅ Ticket submitted to backend by:", name);
  } catch (error) {
    console.error("❌ Error submitting ticket:", error);
    alert("Ticket submission failed. Please try again.");
  }
};
  const removeFromList = (item, setList) => {
    setList((prev) => prev.filter((x) => x !== item));
  };

  const deleteTicket = (id) => {
  const confirmDelete = window.confirm("Are you sure you want to delete this ticket?");
  if (!confirmDelete) return;

  setTickets((prev) => prev.filter((t) => t.id !== id));
};


  const getTicketStyle = (ticket) => {
    let base = "shadow-md rounded-lg p-4 relative border transition duration-200";
    if (ticket.priority === "Urgent" && ticket.shootType === "Live") {
      return `${base} bg-gradient-to-br from-red-100 to-blue-100 border-red-500`;
    } else if (ticket.priority === "Urgent") {
      return `${base} bg-red-100 border-red-400`;
    } else if (ticket.shootType === "Live") {
      return `${base} bg-blue-100 border-blue-400`;
    }
    return `${base} bg-white border-gray-200`;
  };

  const getIcon = (ticket) => {
  if (ticket.priority === "Urgent" && ticket.shootType === "Live") {
    return (
      <div className="flex items-center gap-1 text-red-600">
        <AlertTriangle size={18} />
        <RadioTower size={18} />
      </div>
    );
  }
  if (ticket.priority === "Urgent") {
    return <AlertTriangle size={18} className="text-red-600" />;
  }
  if (ticket.shootType === "Live") {
    return <RadioTower size={18} className="text-blue-600" />;
  }
  return <FileText size={18} className="text-gray-500" />;
};

  return (
    <div className="space-y-8">
      
      {/* FORM */}
{loggedInUser?.roles?.some(r =>
  ["admin", "journalist", "producer", "sports_journalist"].includes(r.toLowerCase())
) && (
      <form
        onSubmit={handleSubmit}
        className="bg-white shadow-lg rounded-xl p-8 w-full max-w-3xl space-y-4"
      >
        <input
          type="text"
          name="title"
          placeholder="Title"
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
          value={formData.title}
          onChange={handleChange}
        />

        {/* Job Type */}
        <div className="space-y-2">
          <label className="block font-semibold mb-1">Request Type</label>
          <div className="flex items-center gap-2">
           <select
  name="type"
  value={formData.type}
  onChange={(e) => {
    const userRoles = loggedInUser?.roles?.map((r) => r.toLowerCase()) || [];
let detectedRole = "journalist";
if (userRoles.includes("producer")) {
  detectedRole = "producer";
} else if (userRoles.includes("admin")) {
  detectedRole = "admin";
} else if (
  loggedInUser?.description?.toLowerCase().includes("sport")
) {
  detectedRole = "sports_journalist";
} else if (userRoles.includes("journalist")) {
  detectedRole = "journalist";
}
    const newShootType = getDefaultShootType(detectedRole, newType);

    setFormData({
      ...formData,
      type: newType,
      shootType: newShootType,
      category: "",
      subtype: "",
    });
  }}
              className="input flex-1"
            >
              <option value="">Select Type</option>
              {jobTypes.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                const newItem = prompt("Enter new type:");
                if (newItem && !jobTypes.includes(newItem)) {
                  setJobTypes([...jobTypes, newItem]);
                }
              }}
              className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >+ Add</button>
          </div>
        </div>

     {/* Assigned Reporter Dropdown */}
<div className="space-y-2">
  <label className="block font-semibold mb-1">Assigned Journalist/Producer</label>
  <select
    name="assignedReporter"
    value={formData.assignedReporter}
    onChange={(e) =>
      setFormData({ ...formData, assignedReporter: e.target.value })
    }
    className="input"
  >
    <option value="">-- Select Reporter --</option>

    {/* Logged-in user shown first if relevant */}
    {(() => {
      const isJournalist = loggedInUser?.roles?.some((r) => r.toLowerCase() === "journalist");
      const isSports = loggedInUser?.description?.toLowerCase().includes("sport") ||
                       loggedInUser?.roles?.some((r) => r.toLowerCase() === "sports_journalist");
      const isProducer = loggedInUser?.roles?.some((r) => r.toLowerCase() === "producer");

      if (isJournalist)
        return (
          <option value={`Journalist: ${loggedInUser.name}`}>
            Journalist: {loggedInUser.name} (You)
          </option>
        );
      if (isSports)
        return (
          <option value={`Sports Journalist: ${loggedInUser.name}`}>
            Sports Journalist: {loggedInUser.name} (You)
          </option>
        );
      if (isProducer)
        return (
          <option value={`Producer: ${loggedInUser.name}`}>
            Producer: {loggedInUser.name} (You)
          </option>
        );

      return null;
    })()}

    <optgroup label="Journalists">
      {users
        .filter((u) =>
          (u.roles || []).some((r) => r.toLowerCase() === "journalist") &&
          u.name !== loggedInUser?.name
        )
        .map((u) => (
          <option key={`journalist-${u.name}`} value={`Journalist: ${u.name}`}>
            Journalist: {u.name}
          </option>
        ))}
    </optgroup>

    <optgroup label="Sports Journalists">
      {users
        .filter(
          (u) =>
            u.description?.toLowerCase().includes("sport") ||
            (u.roles || []).some((r) => r.toLowerCase() === "sports_journalist")
        )
        .filter((u) => u.name !== loggedInUser?.name)
        .map((u) => (
          <option
            key={`sports-${u.name}`}
            value={`Sports Journalist: ${u.name}`}
          >
            Sports Journalist: {u.name}
          </option>
        ))}
    </optgroup>

    <optgroup label="Producers">
      {users
        .filter((u) =>
          (u.roles || []).some((r) => r.toLowerCase() === "producer")
        )
        .filter((u) => u.name !== loggedInUser?.name)
        .map((u) => (
          <option key={`producer-${u.name}`} value={`Producer: ${u.name}`}>
            Producer: {u.name}
          </option>
        ))}
    </optgroup>
  </select>
</div>



        {/* News Dropdown */}
        {formData.type === "News" && (
          <div className="space-y-1 relative z-10">
            <label className="block font-semibold mb-1">News Category</label>
            <div className="relative inline-block w-full">
              <div
                className="input cursor-pointer"
                onClick={() => setShowNewsDropdown((prev) => !prev)}
              >{formData.category || "Select News Category"}</div>

              {showNewsDropdown && (
                <div className="absolute mt-1 w-full bg-white border rounded shadow-md max-h-60 overflow-y-auto z-10">
                  {newsCategories.map((item) => (
                    <div
                      key={item}
                      className="flex justify-between items-center px-4 py-2 hover:bg-gray-100 cursor-pointer group"
                      onClick={() => {
                        setFormData({ ...formData, category: item });
                        setShowNewsDropdown(false);
                      }}
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromList(item, setNewsCategories);
                        }}
                        className="text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      >❌</button>
                    </div>
                  ))}
                  <div
                    className="px-4 py-2 text-blue-600 hover:bg-blue-50 cursor-pointer font-medium"
                    onClick={() => {
                      const newItem = prompt("Enter new news category:");
                      if (newItem && !newsCategories.includes(newItem)) {
                        setNewsCategories([...newsCategories, newItem]);
                        setFormData({ ...formData, category: newItem });
                        setShowNewsDropdown(false);
                      }
                    }}
                  >➕ Add new category</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sports Dropdown */}
        {formData.type === "Sports" && (
          <div className="space-y-1 relative z-10">
            <label className="block font-semibold mb-1">Sport Subtype</label>
            <div className="relative inline-block w-full">
              <div
                className="input cursor-pointer"
                onClick={() => setShowSportsDropdown((prev) => !prev)}
              >{formData.subtype || "Select Sport Subtype"}</div>

              {showSportsDropdown && (
                <div className="absolute mt-1 w-full bg-white border rounded shadow-md max-h-60 overflow-y-auto z-10">
                  {sportsCategories.map((item) => (
                    <div
                      key={item}
                      className="flex justify-between items-center px-4 py-2 hover:bg-gray-100 cursor-pointer group"
                      onClick={() => {
                        setFormData({ ...formData, subtype: item });
                        setShowSportsDropdown(false);
                      }}
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromList(item, setSportsCategories);
                        }}
                        className="text-red-500 text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                      >❌</button>
                    </div>
                  ))}
                  <div
                    className="px-4 py-2 text-blue-600 hover:bg-blue-50 cursor-pointer font-medium"
                    onClick={() => {
                      const newItem = prompt("Enter new sport subtype:");
                      if (newItem && !sportsCategories.includes(newItem)) {
                        setSportsCategories([...sportsCategories, newItem]);
                        setFormData({ ...formData, subtype: newItem });
                        setShowSportsDropdown(false);
                      }
                    }}
                  >➕ Add new subtype</div>
                </div>
              )}
            </div>
          </div>
        )}

      <DatePicker
  selected={selectedDate}
  onChange={(date) => {
    setSelectedDate(date);

    const pad = (n) => String(n).padStart(2, "0");
    const filmingISO = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

    const departureDate = new Date(date.getTime() - 30 * 60000);
    departureDate.setSeconds(0);
    departureDate.setMilliseconds(0);
    const roundedMinutes = Math.floor(departureDate.getMinutes() / 5) * 5;
    departureDate.setMinutes(roundedMinutes);
    const departureStr = departureDate.toTimeString().slice(0, 5); // HH:mm

    setFormData({
      ...formData,
      date: filmingISO, // filming datetime in local time
      filmingTime: filmingISO.split("T")[1], // HH:mm for legacy
      departureTime: departureStr,
    });
  }}
  showTimeSelect
  timeIntervals={5}
  dateFormat="yyyy-MM-dd HH:mm"
  className="input"
  placeholderText="Select filming date and time"
  popperPlacement="bottom-start"
/>


<input
  type="text"
  name="location"
  placeholder="Location"
  className="input"
  value={formData.location}
  onChange={handleChange}
/>

 <label className="block font-semibold">Departure Time</label>
<input
  type="time"
  name="departureTime"
  value={formData.departureTime}
  onChange={handleChange}
  className="input"
  step="300"
/>

        <select
          name="priority"
          value={formData.priority}
          onChange={handleChange}
          className="input"
        >
          <option value="Normal">Normal</option>
          <option value="Urgent">Urgent</option>
        </select>

        {/* Camera Ops Section */}
  {loggedInUser?.roles?.includes("admin") && (
  <div className="space-y-2">
    <label className="block font-semibold mb-1">Number of Cameras Required</label>
 <div className="space-y-2">
  <select
    name="camCount"
    value={isCustomCamCount ? "custom" : formData.camCount}
    onChange={(e) => {
      if (e.target.value === "custom") {
        setIsCustomCamCount(true);
        setFormData({ ...formData, camCount: 1 }); // default custom value
      } else {
        setIsCustomCamCount(false);
        setFormData({ ...formData, camCount: parseInt(e.target.value) });
      }
    }}
    className="input"
  >
    {[1, 2, 3, 4, 5, 6].map((num) => (
      <option key={num} value={num}>
        {num}
      </option>
    ))}
    <option value="custom">Custom</option>
  </select>

  {isCustomCamCount && (
    <input
      type="number"
      min="1"
      max="20"
      placeholder="Enter number"
      className="input"
      value={formData.camCount}
      onChange={(e) =>
        setFormData({
          ...formData,
          camCount: parseInt(e.target.value) || 1,
        })
      }
    />
  )}
</div>
    <label className="flex items-center space-x-2">
      <input
        type="checkbox"
        checked={formData.onlyOneCamOp}
        onChange={(e) =>
          setFormData({
            ...formData,
            onlyOneCamOp: e.target.checked,
            camAssignments: {
              ...formData.camAssignments,
              cam2: "",
              cam3: "",
            },
          })
        }
      />
      <span>Only 1 Cam Op Required (Even For Multiple Cameras)</span>
    </label>

   <div className="space-y-2">
  <label className="block font-semibold">Assign Camera Operators:</label>
 <MultiSelectCombobox
  sections={camOperatorsSections}
  selected={formData.assignedCamOps}
  onChange={(newSelection) =>
    setFormData({
      ...formData,
      assignedCamOps: newSelection,
    })
  }
  getOptionLabel={(name) => {
    const status = camOpStatuses[name];
    if (status === "Off Duty") {
      return `${name} ⚠️ (Off)`;
    }
    if (status === "Afternoon Shift") {
      return `${name} 🌙 (Afternoon)`;
    }
    if (status === "Primary Duty") {
      return `${name} ⭐ (Primary)`;
    }
    if (status === "Backup Duty") {
      return `${name} 🟢 (Backup)`;
    }
    if (status === "Other Duty") {
      return `${name} 🟡 (On Duty)`;
    }
    return name;
  }}
/>
</div>
  </div>
)}
        <select
          name="shootType"
          value={formData.shootType}
          onChange={handleChange}
          className="input"
        >
          <option value="">Shoot Type</option>
          <option value="Live">Live</option>
          <option value="EFP">EFP</option>
          <option value="B-roll">B-roll Only</option>
          <option value="ENG">ENG</option>
        </select>
        
        {can("canAddNotes") && (
          <textarea
    name="notes"
    placeholder="Additional notes or instructions"
    className="input h-24"
    value={formData.notes}
    onChange={handleChange}
    />
    )}

{can("canAssignVehicle") && (
  <div className="space-y-4 border-t pt-4 mt-6">
    <h3 className="text-lg font-semibold text-gray-800">Fleet Section</h3>

    <div>
      <label className="block font-medium mb-1">Assigned Vehicle</label>
      <select
  name="vehicle"
  value={formData.vehicle}
  onChange={handleChange}
  className="input"
>
  <option value="">Select a vehicle</option>
  {vehicles.map((v) => (
    <option key={v.id} value={v.name}>
      {v.name}
    </option>
  ))}
</select>

    </div>

    {formData.vehicle && (() => {
  const selectedVehicle = vehicles.find(
    (v) => v.name === formData.vehicle
  );
  if (!selectedVehicle) return null;

  const today = new Date();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(today.getMonth() + 3);

  const isInsuranceExpiring =
    selectedVehicle.insuranceDue &&
    new Date(selectedVehicle.insuranceDue) <= threeMonthsFromNow;

  const isTestExpiring =
    selectedVehicle.testDue &&
    new Date(selectedVehicle.testDue) <= threeMonthsFromNow;

  const isPatentExpiring =
    selectedVehicle.patentDue &&
    new Date(selectedVehicle.patentDue) <= threeMonthsFromNow;

  return (
    <div className="mt-2 text-sm space-y-1">
      {selectedVehicle.status && selectedVehicle.status !== "Available" && (
        <div className="text-red-600 font-semibold">
          Status: {selectedVehicle.status}
        </div>
      )}

      {isInsuranceExpiring && (
        <div className="text-yellow-600">
          ⚠ Insurance expires on {selectedVehicle.insuranceDue}
        </div>
      )}

      {isTestExpiring && (
        <div className="text-yellow-600">
          ⚠ Vehicle Test due on {selectedVehicle.testDue}
        </div>
      )}

      {isPatentExpiring && (
        <div className="text-yellow-600">
          ⚠ Patent expires on {selectedVehicle.patentDue}
        </div>
      )}
    </div>
  );
})()}
  </div>
)}
        <button
          type="submit"
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
        >Submit Ticket</button>
      </form>
      )}
{/* === Show Only 7 Most Recent Tickets (Better Layout + Status + See More) === */}
{showRecent && (
  <div className="mt-10 bg-white p-4 rounded-lg shadow space-y-2">
    <h2 className="text-lg font-semibold mb-2">Recent Tickets</h2>
    <ul className="space-y-4">
      {[...tickets].reverse().slice(0, 7).map((ticket) => (
        <li key={ticket.id} className="bg-white p-4 rounded shadow-sm border">
          <a className="text-blue-600 font-semibold text-lg">{ticket.title}</a>
          <p className="text-sm text-gray-700 mt-1">
            <strong>Type:</strong> {ticket.type} |{" "}
            <strong>Location:</strong> {ticket.location} |{" "}
            <strong>Time:</strong> {ticket.departureTime} |{" "}
            <strong>Priority:</strong> {ticket.priority} |{" "}
            <strong>Shoot:</strong> {ticket.shootType}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 mt-1 text-sm">
  <StatusBadge status={ticket.status} />
  <AssignmentBadge status={ticket.assignmentStatus} />
  <span className="text-gray-500">
    Created by: {ticket.createdBy} <br />
    {new Date(ticket.createdAt).toLocaleString("en-GB")}
  </span>
</div>

        </li>
      ))}
    </ul>

    <button
      type="button"
      onClick={() => navigate("/tickets")}
      className="mt-4 px-4 py-2 bg-blue-700 text-white rounded hover:bg-blue-800"
    >
      See More
    </button>
  </div>
)}

</div>
  
  );
}

export default TicketForm;
