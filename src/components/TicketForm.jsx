import { useState, useEffect, useRef } from "react";
import { AlertTriangle, RadioTower, FileText } from 'lucide-react';
import DynamicDropdown from "./DynamicDropdown";
import StatusBadge from "./StatusBadge";
import AssignmentBadge from "./AssignmentBadge";
import DutyBadge from "@/components/DutyBadge";
import DatePicker from "react-datepicker";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster";

/* === Shared roster + badge helpers (same as TicketPage) === */
function getWeekStart(dateISO) {
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return "";
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function getHourForBadges(dateISO, filmingTime) {
  try {
    if (filmingTime && /^\d{2}:\d{2}/.test(filmingTime)) {
      const h = parseInt(filmingTime.split(":")[0], 10);
      if (Number.isFinite(h)) return h;
    }
    const d = new Date(dateISO);
    if (!isNaN(d.getTime())) return d.getHours();
  } catch {}
  return 0;
}

const rosterCache = {};

/** Fetch week roster once per Monday key */
async function fetchRosterForDate(dateISO) {
  const weekStart = getWeekStart(dateISO);
  if (!weekStart) return [];
  if (rosterCache[weekStart]) return rosterCache[weekStart];
  try {
    const res = await fetch(`${API_BASE}/rosters/${weekStart}`);
    if (!res.ok) throw new Error("Roster not found");
    const data = await res.json();
    rosterCache[weekStart] = Array.isArray(data) ? data : [];
    return rosterCache[weekStart];
  } catch (err) {
    console.warn("No roster for week:", weekStart, err?.message || err);
    rosterCache[weekStart] = [];
    return [];
  }
}

/** Normalize Operations roster into { off, afternoonShift, primary } */
async function getTodayRoster(dateOnlyISO) {
  const week = await fetchRosterForDate(dateOnlyISO);
  const day = week.find(
    (d) => d?.date?.slice(0, 10) === String(dateOnlyISO).slice(0, 10)
  );
  if (!day) return { off: [], afternoonShift: [], primary: [] };

  const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const extractNames = (list) => {
    const arr = toArray(list);
    const names = [];
    for (const item of arr) {
      if (!item) continue;
      if (typeof item === "string") {
        item
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((n) => names.push(n));
      } else if (typeof item === "object" && item.name) {
        names.push(String(item.name).trim());
      }
    }
    return Array.from(new Set(names.filter(Boolean)));
  };

  const camOpsRoot =
    day.camOps || day.operations?.camOps || day.ops?.camOps || day;

  const off =
    extractNames(
      camOpsRoot?.off ??
      camOpsRoot?.offDuty ??
      camOpsRoot?.off_cam_ops ??
      day.off ??
      day.offDuty
    ) || [];

  const afternoonShift =
    extractNames(
      camOpsRoot?.afternoonShift ??
      camOpsRoot?.pmShift ??
      camOpsRoot?.afternoon ??
      day.afternoonShift ??
      day.pmShift
    ) || [];

  const primary =
    extractNames(
      camOpsRoot?.primary ??
      camOpsRoot?.directingNews ??
      camOpsRoot?.directing ??
      day.primary ??
      day.directingNews ??
      day.directing
    ) || [];

  return { off, afternoonShift, primary };
}

/* === DutyBadgeWrapper: shows ONLY Off Duty / Afternoon Shift / Directing News === */
function DutyBadgeWrapper({ date, filmingTime, names = [] }) {
  const [groups, setGroups] = useState({ off: [], afternoonShift: [], primary: [] });
  const dutyDateOnly = String(date || "").slice(0, 10);
  const hour = getHourForBadges(date, filmingTime); // fallback to ticket.date if filmingTime missing

  useEffect(() => {
    if (dutyDateOnly) {
      getTodayRoster(dutyDateOnly).then((g) =>
        setGroups({
          off: Array.isArray(g?.off) ? g.off : [],
          afternoonShift: Array.isArray(g?.afternoonShift) ? g.afternoonShift : [],
          primary: Array.isArray(g?.primary) ? g.primary : [],
        })
      );
    } else {
      setGroups({ off: [], afternoonShift: [], primary: [] });
    }
  }, [dutyDateOnly]);

  const normalizeName = (val) => {
    const s = String(val || "")
      .replace(/^\s*(cam\s*op|camop|journalist|sports\s*journalist|producer)\s*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return s;
  };
  const has = (arr, name) => {
    if (!Array.isArray(arr)) return false;
    const target = normalizeName(name);
    return arr.some((n) => normalizeName(n) === target);
  };

  const list = Array.isArray(names) ? names : [];

  return (
    <div className="flex flex-col gap-1">
      {list.map((name, i) => {
        let badge = null;
        if (has(groups.off, name)) {
          badge = <DutyBadge label="Off Duty" color="red" />;
        } else if (has(groups.primary, name) && hour >= 12) {
          badge = <DutyBadge label="Directing News" color="blue" />;
        } else if (has(groups.afternoonShift, name) && hour < 12) {
          badge = <DutyBadge label="Afternoon Shift" color="yellow" />;
        }
        return (
          <div key={i} className="flex items-center justify-start gap-2">
            <span>{name}</span>
            {badge}
          </div>
        );
      })}
    </div>
  );
}

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

// B) NEW — getInitialFormData (explicit empty assignedReporter)
function getInitialFormData(loggedInUser) {
  const now = new Date();
  const userRoles = loggedInUser?.roles?.map((r) => r.toLowerCase()) || [];

  let detectedRole = "journalist"; // fallback
  if (userRoles.includes("producer")) {
    detectedRole = "producer";
  } else if (userRoles.includes("admin")) {
    detectedRole = "admin";
  } else if ((loggedInUser?.description || "").toLowerCase().includes("sport")) {
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
    // Common/default fields
    title: "",
    type: defaultType,
    category: "",
    subtype: "",
    date: isoDate,
    location: "",
    notes: "",

    // Non-technical defaults
    priority: "Normal",
    camOp: true,
    shootType: defaultShoot,
    camCount: 1,
    onlyOneCamOp: true,
    camAssignments: { cam1: "", cam2: "", cam3: "" },
    departureTime: departureStr,
    filmingTime: departureStr,
    assignedCamOps: [],
    assignedDriver: "",
    vehicle: "",
    assignmentStatus: "Unassigned",
    isReady: false,
    status: "Pending",

    // 🔑 Allow reporter to be truly optional
    assignedReporter: "",

    // 👉 NEW: EFP/Live crew assignments (expanded view on TicketPage)
    // Array of { role: string, assignees: string[] }
    crewAssignments: [],

    // Technical-only fields (used when type === "Technical")
    scopeOfWork: "",
    assignedTechnicians: [],
  };
}

function TicketForm({ users = [], loggedInUser, tickets = [], setTickets, vehicles = [], showRecent = false }) {
  const navigate = useNavigate();
  console.log("Current logged in user:", loggedInUser);
  const [formData, setFormData] = useState(getInitialFormData(loggedInUser));
  const [selectedDate, setSelectedDate] = useState(
    formData.date ? new Date(formData.date) : new Date()
  );
  const [jobTypes, setJobTypes] = useState(["News", "Sports", "Production", "Technical"]);
  const [newsCategories, setNewsCategories] = useState(["Press Conference", "Interview"]);
  const [sportsCategories, setSportsCategories] = useState(["Football", "Basketball", "Training", "Match"]);
  const [showNewsDropdown, setShowNewsDropdown] = useState(false);
  const [showSportsDropdown, setShowSportsDropdown] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterShootType, setFilterShootType] = useState("");

  // Load rosters from localStorage (kept for label decoration), but we’ll also fetch from API for badges
  const [selectedRosterDay, setSelectedRosterDay] = useState(null);
  const [camOpStatuses, setCamOpStatuses] = useState({});

  // ✅ Fallback users fetch if the `users` prop is empty
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [usersLoadError, setUsersLoadError] = useState(null);

  /**
   * We only fetch if the `users` prop is empty.
   * Keeps current behavior when parent already provides users.
   */
  useEffect(() => {
    if (users && users.length > 0) {
      // Parent is providing users; ensure we don't override
      setRemoteUsers([]);
      setUsersLoadError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/users`, { method: "GET" });
        // normalize response: support [] or { users: [] }
        const raw = await res.json().catch(() => []);
        const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.users) ? raw.users : [];

        if (!cancelled) {
          setRemoteUsers(arr);
          if (!arr || arr.length === 0) {
            console.warn("⚠️ /users returned an empty list.");
          }
        }
      } catch (err) {
        console.error("❌ Failed to fetch users:", err);
        if (!cancelled) setUsersLoadError(err?.message || "Unknown error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [users]);

  // ✅ Use this unified list everywhere below
  const effectiveUsers = (users && users.length > 0) ? users : remoteUsers;

  // === TicketPage-identical helpers for badges ===
  const rosterCache = useRef({});
  const getWeekStart = (dateISO) => {
    const d = new Date(dateISO);
    if (isNaN(d.getTime())) return "";
    const day = d.getDay(); // 0=Sun ... 6=Sat
    const diff = day === 0 ? -6 : 1 - day; // Monday start
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  };
  const getHourForBadges = (dateISO, filmingTime) => {
    try {
      if (filmingTime && /^\d{2}:\d{2}/.test(filmingTime)) {
        const h = parseInt(filmingTime.split(":")[0], 10);
        if (Number.isFinite(h)) return h;
      }
      const d = new Date(dateISO);
      if (!isNaN(d.getTime())) return d.getHours();
    } catch {}
    return 0;
  };
  async function fetchRosterForDate(dateISO) {
    const weekStart = getWeekStart(dateISO);
    if (!weekStart) return [];
    if (rosterCache.current[weekStart]) return rosterCache.current[weekStart];
    try {
      const res = await fetch(`${API_BASE}/rosters/${weekStart}`);
      if (!res.ok) throw new Error("Roster not found");
      const data = await res.json();
      rosterCache.current[weekStart] = Array.isArray(data) ? data : [];
      return rosterCache.current[weekStart];
    } catch (err) {
      console.warn("No roster for week:", weekStart, err?.message || err);
      rosterCache.current[weekStart] = [];
      return [];
    }
  }
  async function getTodayRoster(dateOnlyISO) {
    const week = await fetchRosterForDate(dateOnlyISO);
    const day = week.find(
      (d) => d?.date?.slice(0, 10) === String(dateOnlyISO).slice(0, 10)
    );

    // Normalize to the three groups TicketPage expects: off, afternoonShift, primary
    if (!day) return { off: [], afternoonShift: [], primary: [] };

    const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const extractNames = (list) => {
      const arr = toArray(list);
      const names = [];
      for (const item of arr) {
        if (!item) continue;
        if (typeof item === "string") {
          item
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((n) => names.push(n));
        } else if (typeof item === "object" && item.name) {
          names.push(String(item.name).trim());
        }
      }
      return Array.from(new Set(names.filter(Boolean)));
    };

    const camOpsRoot =
      day.camOps || day.operations?.camOps || day.ops?.camOps || day;

    const off =
      extractNames(
        camOpsRoot?.off ??
          camOpsRoot?.offDuty ??
          camOpsRoot?.off_cam_ops ??
          day.off ??
          day.offDuty
      ) || [];

    const afternoonShift =
      extractNames(
        camOpsRoot?.afternoonShift ??
          camOpsRoot?.pmShift ??
          camOpsRoot?.afternoon ??
          day.afternoonShift ??
          day.pmShift
      ) || [];

    const primary =
      extractNames(
        camOpsRoot?.primary ??
          camOpsRoot?.directingNews ??
          camOpsRoot?.directing ??
          day.primary ??
          day.directingNews ??
          day.directing
      ) || [];

    return { off, afternoonShift, primary };
  }
  // Badge preview identical to TicketPage
  function DutyBadgeWrapper({ date, filmingTime, names = [] }) {
    const [groups, setGroups] = useState({ off: [], afternoonShift: [], primary: [] });
    const dutyDateOnly = String(date || "").slice(0, 10);
    const hour = getHourForBadges(date, filmingTime); // fallback to ticket.date if filmingTime missing

    useEffect(() => {
      if (dutyDateOnly) {
        getTodayRoster(dutyDateOnly).then((g) =>
          setGroups({
            off: Array.isArray(g?.off) ? g.off : [],
            afternoonShift: Array.isArray(g?.afternoonShift) ? g.afternoonShift : [],
            primary: Array.isArray(g?.primary) ? g.primary : [],
          })
        );
      } else {
        setGroups({ off: [], afternoonShift: [], primary: [] });
      }
    }, [dutyDateOnly]);

    // normalize for matching
    const normalizeName = (val) => {
      const s = String(val || "")
        .replace(/^\s*(cam\s*op|camop|journalist|sports\s*journalist|producer)\s*:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return s;
    };
    const has = (arr, name) => {
      if (!Array.isArray(arr)) return false;
      const target = normalizeName(name);
      return arr.some((n) => normalizeName(n) === target);
    };

    const list = Array.isArray(names) ? names : [];

    return (
      <div className="flex flex-col gap-1">
        {list.map((name, i) => {
          let badge = null;
          if (has(groups.off, name)) {
            badge = <DutyBadge label="Off Duty" color="red" />;
          } else if (has(groups.primary, name) && hour >= 12) {
            badge = <DutyBadge label="Directing News" color="blue" />;
          } else if (has(groups.afternoonShift, name) && hour < 12) {
            badge = <DutyBadge label="Afternoon Shift" color="yellow" />;
          }
          return (
            <div key={i} className="flex items-center justify-start gap-2">
              <span>{name}</span>
              {badge}
            </div>
          );
        })}
      </div>
    );
  }

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

  // Build cam ops lists with final ordering (using unified list)
  const groupOne = [];   // camOp without producer
  const groupTwo = [];   // camOp + producer
  const groupThree = []; // Clive and Gilmer always last

  const specialNames = ["gilmer philoe", "clive camille"];

  // Normalize roles to lowercase array and sort into buckets
  (effectiveUsers || []).forEach((user) => {
    const name = user?.name || "";
    const lowerName = name.toLowerCase();
    const roles = Array.isArray(user?.roles)
      ? user.roles.map((r) => String(r).toLowerCase())
      : [String(user?.role || "").toLowerCase()];

    if (!name) return;

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

  // Final array with a marker for separation (kept for future UI groupings)
  const camOperatorsSections = [
    { label: "CamOps (No Producer)", options: groupOne },
    { label: "CamOps + Producer", options: groupTwo },
    { label: "Senior CamOps", options: groupThree },
  ];

  // ✅ Flatten into plain options the combobox understands
  //    We insert "divider" markers between groups (rendered as thin lines).
  const camOpOptions = [
    ...groupOne.map((name) => ({ label: name, value: name })),
    { label: "––divider––", value: "__divider1", divider: true },

    ...groupTwo.map((name) => ({ label: name, value: name })),
    { label: "––divider––", value: "__divider2", divider: true },

    ...groupThree.map((name) => ({ label: name, value: name })),
  ];

  // ✅ Decorate labels with roster status (without changing the value)
  const decorateLabel = (name, baseLabel) => {
    if (name.startsWith("__divider")) return "––––––––"; // render as line only
    const status = camOpStatuses[name];
    if (status === "Off Duty") return `${baseLabel} ⚠️ (Off)`;
    if (status === "Afternoon Shift") return `${baseLabel} 🌙 (Afternoon Shift)`;
    if (status === "Primary Duty") return `${baseLabel} 🎥 (Directing News)`;
    if (status === "Backup Duty") return `${baseLabel} `;
    if (status === "Other Duty") return `${baseLabel}  `;
    return baseLabel;
  };

  const camOpOptionsDecorated = camOpOptions.map((opt) => ({
  ...opt,
  label: decorateLabel(opt.value, opt.label),
}));

// 👉 NEW: crew combobox options + default templates
const userOptionsCrew = (effectiveUsers || [])
  .map((u) => u?.name)
  .filter(Boolean)
  .map((name) => ({ label: name, value: name }));

   {/* EFP Roles */}
const EFP_LIVE_TEMPLATES = [
  { role: "Director", assignees: [] },
  { role: "Technical Support", assignees: [] },
  { role: "A1", assignees: [] },
  { role: "A2", assignees: [] },
  { role: "Graphic Artist", assignees: [] },
  { role: "Producer", assignees: [] },
  { role: "Drone Operator", assignees: [] },
];

console.log("✅ Cam operators sections:", camOperatorsSections);
console.log("✅ CamOp options (decorated with group tags):", camOpOptionsDecorated);
console.log("✅ All users data (effective):", effectiveUsers);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  // B) NEW — handleSubmit (no fallback; keeps reporter empty if not chosen)

/* ===========================
   🔊 Sound setting starts here
   Ticket toast/sound triggers will be wired ONLY inside this section.
   =========================== */

const { toast } = useToast();

/**
 * Emit hooks for App-level listeners (toast/sound/push, etc.)
 * - loBoard:ticketCreated → raw ticket detail
 * - loBoard:notify → shaped note that matches fireGlobalAlert(note)
 */
const emitTicketCreated = (ticket) => {
  try {
    const urgent =
      ticket?.priority === "Urgent" ||
      ticket?.priority === "High" ||
      ticket?.urgent === true;

    const when =
      typeof ticket?.date === "string" && ticket.date.includes("T")
        ? ticket.date.replace("T", " ")
        : ticket?.date || "";

    const actor = loggedInUser?.name || "Unknown";

    // ✅ IMPORTANT: App.jsx expects category === "ticket" (singular)
    const note = {
      title: "🆕 New Request Created",
      message: `${ticket?.title || "Untitled"}${when ? ` • ${when}` : ""}${
        ticket?.location ? ` • ${ticket.location}` : ""
      }`,
      category: "ticket",
      urgent,
      timestamp: new Date().toISOString(),
      actor,
      // helpful extras (ignored safely if your listener doesn’t use them)
      ticketId: ticket?.id,
      ticketType: ticket?.type,
      ticket, // ✅ allows rich toast formatting
    };

    // Same-tab listeners (keep for compatibility)
    window.dispatchEvent(
      new CustomEvent("loBoard:ticketCreated", { detail: { ticket } })
    );

    // ✅ Main rich-ticket channel (App.jsx listens to this)
    window.dispatchEvent(
      new CustomEvent("loBoard:ticketEvent", {
        detail: {
          title: note.title,
          message: note.message,
          category: "ticket",
          urgent,
          actor,
          ticketId: ticket?.id,
          ticket,
          ts: Date.now(),
          timestamp: new Date().toISOString(),
          action: "Created",
        },
      })
    );

    // ✅ Also emit shaped notify (App.jsx listens to this too)
    window.dispatchEvent(new CustomEvent("loBoard:notify", { detail: note }));

    // Optional cross-tab broadcast (safe no-op if unsupported)
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel("loBoard");
      ch.postMessage({ type: "notify", note });
      ch.close();
    }
  } catch {
    // never block submit flow
  }
};

/**
 * ✅ Backend notification emit (Fleet-style)
 * This is what makes OTHER tabs (Admin view as X) react via App.jsx polling.
 * Non-blocking by design.
 */
const sendTicketNotification = async (ticket) => {
  try {
    const actor = loggedInUser?.name || "Unknown";

    const urgent =
      ticket?.priority === "Urgent" ||
      ticket?.priority === "High" ||
      ticket?.urgent === true;

    const when =
      typeof ticket?.date === "string" && ticket.date.includes("T")
        ? ticket.date.replace("T", " ")
        : ticket?.date || "";

    // Recipients (safe + flexible)
    const recipients = new Set();

    // Actor
    recipients.add(actor);

    // Assigned crew (if present)
    if (Array.isArray(ticket?.assignedCamOps)) {
      ticket.assignedCamOps.filter(Boolean).forEach((n) => recipients.add(n));
    }
    if (ticket?.assignedDriver) recipients.add(ticket.assignedDriver);

    // Reporter field sometimes includes prefixes like "Journalist: Name"
    if (ticket?.assignedReporter) {
      const raw = String(ticket.assignedReporter);
      const cleaned = raw.includes(":")
        ? raw.split(":").slice(1).join(":").trim()
        : raw.trim();
      if (cleaned) recipients.add(cleaned);
      else recipients.add(raw.trim());
    }

    // ✅ Admins (match Fleet behavior)
    recipients.add("Admins");
    recipients.add("admin");
    recipients.add("admins");

    const payload = {
      title: "🆕 New Request Created",
      message: `${ticket?.title || "Untitled"}${when ? ` • ${when}` : ""}${
        ticket?.location ? ` • ${ticket.location}` : ""
      }`,
      recipients: Array.from(recipients),
      timestamp: new Date().toISOString(),

      // ✅ IMPORTANT: App.jsx expects category === "ticket" (singular)
      category: "ticket",
      urgent: !!urgent,

      // ✅ enrich so App poller → fireGlobalAlert can show details
      actor,
      ticketId: ticket?.id,
      ticketType: ticket?.type,
      ticket, // safe to store in JSON backend; ignored if not used
    };

    // ✅ Hard timeout so backend notifications NEVER block UI flow
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      await fetch(`${API_BASE}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // Never break TicketForm if notifications fail
    console.warn("Ticket notification failed (non-blocking):", err);
  }
};

const handleSubmit = async (e) => {
  e.preventDefault();

  const name = loggedInUser?.name || "Unknown";

  // Validation rules
  if (!formData.title?.trim()) {
    alert("Please enter a title.");
    return;
  }
  if (!formData.date) {
    alert("Please select a date and time.");
    return;
  }
  if (!formData.location?.trim()) {
    alert("Please enter a location.");
    return;
  }

  let newTicket;

  if (formData.type === "Technical") {
    // Technical-specific validation
    if (!formData.scopeOfWork?.trim()) {
      alert("Please select or enter a Scope of Work.");
      return;
    }
    if (
      !Array.isArray(formData.assignedTechnicians) ||
      formData.assignedTechnicians.length === 0
    ) {
      alert("Please assign at least one technician.");
      return;
    }

    // Build Technical ticket payload
    newTicket = {
      id: Date.now().toString(),
      type: "Technical",
      title: formData.title,
      date: formData.date,
      location: formData.location,
      // Technical fields
      scopeOfWork: formData.scopeOfWork.trim(),
      assignedTechnicians: formData.assignedTechnicians,
      departureTime: formData.departureTime || "",
      filmingTime: null, // 🔒 always null for Technical
      // Common fields
      status: "Pending",
      assignmentStatus: "Unassigned",
      isReady: false,
      vehicle: formData.vehicle || "",
      vehicleStatus: "",
      // Notes normalized to array
      notes: formData.notes
        ? [
            {
              text: String(formData.notes).trim(),
              author: name,
              timestamp: new Date().toLocaleString(),
            },
          ]
        : [],
      // Reporter hidden for technical; store blank to avoid confusion
      assignedReporter: "",
      // Crew ignored for Technical
      crewAssignments: [],
      createdBy: name,
      createdAt: new Date().toISOString(),
    };
  } else {
    // Non-Technical ticket payload (keeps reporter optional)
    const filmingTimeFromDate = formData.date
      ? formData.date.split("T")[1]?.slice(0, 5)
      : "";

    const isEfpOrLive =
      formData.shootType === "EFP" || formData.shootType === "Live";

    const safeCrew = Array.isArray(formData.crewAssignments)
      ? formData.crewAssignments
          .filter((r) => r && r.role && Array.isArray(r.assignees))
          .map((r) => ({
            role: String(r.role).trim(),
            assignees: r.assignees.filter(Boolean),
          }))
      : [];

    newTicket = {
      id: Date.now().toString(),
      ...formData,
      filmingTime: formData.filmingTime || filmingTimeFromDate || "",
      status: "Pending",
      assignedCamOps: formData.assignedCamOps || [],
      assignedDriver: formData.assignedDriver || "",
      vehicle: formData.vehicle || "",
      vehicleStatus: "",
      assignmentStatus: "Unassigned",
      isReady: false,
      // 🔑 Do NOT auto-fill reporter; leave empty if user didn’t choose anyone
      assignedReporter: formData.assignedReporter || "",
      // 👉 Save crew only for EFP/Live; otherwise store empty array
      crewAssignments: isEfpOrLive ? safeCrew : [],
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
  }

  console.log("🚀 handleSubmit triggered");

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
    setFormData(getInitialFormData(loggedInUser));
    console.log("✅ Ticket submitted to backend by:", name);

    // ✅ 1) Local same-tab + optional cross-tab emits (NEVER blocked)
    emitTicketCreated(savedTicket);

    // ✅ 2) Local UI toast (NEVER blocked)
    toast({
      title: "✅ Request Created",
      description: `${savedTicket?.title || "Untitled"}${
        savedTicket?.date
          ? ` • ${String(savedTicket.date).replace("T", " ")}`
          : ""
      }${savedTicket?.location ? ` • ${savedTicket.location}` : ""}`,
      duration: 4500,
    });

    // ✅ 3) Backend notifications feed (fire-and-forget; NEVER blocks)
    //     If it fails or stalls, the timeout in sendTicketNotification prevents hanging.
    try {
      void sendTicketNotification(savedTicket);
    } catch {
      // ignore
    }
  } catch (error) {
    console.error("❌ Error submitting request:", error);
    alert("Request submission failed. Please try again.");
  }
};

/* =========================
   🔊 Sound setting ends here
   ========================= */


  const removeFromList = (item, setList) => {
    setList((prev) => prev.filter((x) => x !== item));
  };

  const deleteTicket = (id) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this request form?");
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

  // Keep your existing roster decoration effect (for option labels)
  useEffect(() => {
    const selectedDateIso = formData.date?.split("T")[0];
    if (!selectedDateIso) {
      setSelectedRosterDay(null);
      setCamOpStatuses({});
      return;
    }

    const getWeekStartLocal = (dateStr) => {
      const date = new Date(dateStr);
      const day = date.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      date.setDate(date.getDate() + diff);
      date.setHours(0, 0, 0, 0);
      return date.toISOString().split("T")[0];
    };

    const weekStart = getWeekStartLocal(selectedDateIso);

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
        const newType = e.target.value;
        const userRoles = loggedInUser?.roles?.map((r) => r.toLowerCase()) || [];
        let detectedRole = "journalist";

        if (userRoles.includes("producer")) detectedRole = "producer";
        else if (userRoles.includes("admin")) detectedRole = "admin";
        else if ((loggedInUser?.description || "").toLowerCase().includes("sport")) detectedRole = "sports_journalist";
        else if (userRoles.includes("journalist")) detectedRole = "journalist";

        const newShootType = getDefaultShootType(detectedRole, newType);
        const existingDate = formData.date || new Date().toISOString().slice(0, 16);

        if (newType === "Technical") {
          // Clear non-tech + also clear crewAssignments
          setFormData({
            ...formData,
            type: newType,
            shootType: "",
            category: "",
            subtype: "",
            priority: "",
            assignedCamOps: [],
            camCount: 1,
            onlyOneCamOp: true,
            camAssignments: { cam1: "", cam2: "", cam3: "" },
            crewAssignments: [], // 🔄 reset crew when going Technical
            scopeOfWork: "",
            assignedTechnicians: [],
            date: existingDate,
          });
        } else {
          // Non-technical
          setFormData({
            ...formData,
            type: newType,
            shootType: newShootType,
            category: "",
            subtype: "",
            priority: formData.priority || "Normal",
            date: existingDate,
          });
        }
      }}
      className="input flex-1"
    >
      <option value="">Select Type</option>
      {jobTypes.map((type) => (
        <option key={type} value={type}>
          {type}
        </option>
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
    >
      + Add
    </button>
  </div>
</div>

          {/* Assigned Reporter (hidden in Technical) */}
{formData.type !== "Technical" && (
  <div className="space-y-2">
    <label className="block font-semibold mb-1">Assigned Journalist/Producer</label>
    <select
      name="assignedReporter"
      value={formData.assignedReporter}
      onChange={(e) => setFormData({ ...formData, assignedReporter: e.target.value })}
      className="input"
    >
      <option value="">-- Select Reporter --</option>

      {/* Logged-in user shown first if relevant */}
      {(() => {
        const isJournalist = loggedInUser?.roles?.some((r) => r.toLowerCase() === "journalist");
        const isSports = (loggedInUser?.description || "").toLowerCase().includes("sport") ||
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
        {(effectiveUsers || [])
          .filter((u) => {
            const roles = (u.roles || []).map((r) => String(r).toLowerCase());
            const desc = (u.description || "").toLowerCase();
            return roles.includes("journalist") && !desc.includes("sports") && u.name !== loggedInUser?.name;
          })
          .map((u) => (
            <option key={`journalist-${u.name}`} value={`Journalist: ${u.name}`}>
              Journalist: {u.name}
            </option>
          ))}
      </optgroup>

      <optgroup label="Sports Journalists">
        {(effectiveUsers || [])
          .filter(
            (u) =>
              (u.description || "").toLowerCase().includes("sport") ||
              (u.roles || []).some((r) => String(r).toLowerCase() === "sports_journalist")
          )
          .filter((u) => u.name !== loggedInUser?.name)
          .map((u) => (
            <option key={`sports-${u.name}`} value={`Sports Journalist: ${u.name}`}>
              Sports Journalist: {u.name}
            </option>
          ))}
      </optgroup>

      <optgroup label="Producers">
        {(effectiveUsers || [])
          .filter((u) => (u.roles || []).some((r) => String(r).toLowerCase() === "producer"))
          .filter((u) => u.name !== loggedInUser?.name)
          .map((u) => (
            <option key={`producer-${u.name}`} value={`Producer: ${u.name}`}>
              Producer: {u.name}
            </option>
          ))}
      </optgroup>
    </select>
  </div>
)}

{/* Technical-only fields */}
{formData.type === "Technical" && (
  <div className="space-y-4">
    {/* Scope of Work */}
    <div className="space-y-2">
      <label className="block font-semibold mb-1">Scope of Work</label>
      <div className="flex items-center gap-2">
        <select
          className="input flex-1"
          value={formData.scopeOfWork || ""}
          onChange={(e) => setFormData({ ...formData, scopeOfWork: e.target.value })}
        >
          <option value="">Select scope</option>
          <option value="Recce">Recce</option>
          <option value="Setup">Setup</option>
          <option value="Signal Test">Signal Test</option>
          <option value="Tech Rehearsal">Tech Rehearsal</option>
        </select>
        <button
          type="button"
          onClick={() => {
            const val = prompt("Enter a custom scope of work:");
            if (val && val.trim()) {
              setFormData({ ...formData, scopeOfWork: val.trim() });
            }
          }}
          className="px-3 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          + Add
        </button>
      </div>
    </div>

    {/* Assigned Technicians */}
    <div className="space-y-2">
      <label className="block font-semibold">Assigned Technician(s)</label>
      {(() => {
        const techTop = ["Christopher Gabriel", "Gilmer Philoe", "Darino Esther"];
        const allNames = (effectiveUsers || []).map((u) => u?.name).filter(Boolean);
        const rest = Array.from(new Set(allNames.filter((n) => !techTop.includes(n)))).sort();
        const ordered = [...techTop.filter((n) => allNames.includes(n)), ...rest];
        const techOptions = ordered.map((name) => ({ label: name, value: name }));

        return (
          <MultiSelectCombobox
            options={techOptions}
            selected={formData.assignedTechnicians}
            onChange={(next) => {
              const values = (next || []).map((v) => (typeof v === "string" ? v : v?.value)).filter(Boolean);
              setFormData({ ...formData, assignedTechnicians: values });
            }}
          />
        );
      })()}
    </div>
  </div>
)}

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

         {formData.type !== "Technical" && (
  <select
    name="priority"
    value={formData.priority}
    onChange={handleChange}
    className="input"
  >
    <option value="Normal">Normal</option>
    <option value="Urgent">Urgent</option>
  </select>
)}


          {/* Camera Ops Section */}
          {["News", "Sports", "Production"].includes(formData.type) && (
  <div className="space-y-2">
    <label className="block font-semibold mb-1">Number of Cameras Required</label>

    <div className="space-y-2">
      <select
        name="camCount"
        value={isCustomCamCount ? "custom" : formData.camCount}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setIsCustomCamCount(true);
            setFormData({ ...formData, camCount: 1 });
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

    <div className="flex items-center gap-4">
      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          checked={formData.onlyOneCamOp}
          onChange={(e) =>
            setFormData({
              ...formData,
              onlyOneCamOp: e.target.checked,
              expectedCamOps: e.target.checked ? 1 : formData.expectedCamOps || 1,
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

      {!formData.onlyOneCamOp && (
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium">Cam Ops Needed:</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={formData.expectedCamOps || 1}
            onChange={(e) =>
              setFormData({
                ...formData,
                expectedCamOps: parseInt(e.target.value),
              })
            }
          >
            {Array.from({ length: 8 }, (_, i) => i + 1).map((num) => (
              <option key={num} value={num}>
                {num}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>

      <div className="space-y-2">
        <label className="block font-semibold">Assign Camera Operators:</label>
        <MultiSelectCombobox
          options={camOpOptionsDecorated}
          selected={formData.assignedCamOps}
          onChange={(next) => {
            const values = (next || [])
              .map((v) => (typeof v === "string" ? v : v?.value))
              .filter((val) => val && !val.startsWith("__divider")); // ignore divider markers
            setFormData({
              ...formData,
              assignedCamOps: values,
            });
          }}
        />
      </div>
    </div>
  )}
          {/* ❌ Removed “Require Driver” block entirely */}

         {formData.type !== "Technical" && (
  <div className="space-y-4">
    <select
      name="shootType"
      value={formData.shootType}
      onChange={(e) => {
        const nextShoot = e.target.value;
        // Seed templates when switching into EFP/Live (if empty)
        setFormData((prev) => {
          const shouldSeed =
            (nextShoot === "EFP" || nextShoot === "Live") &&
            (!Array.isArray(prev.crewAssignments) || prev.crewAssignments.length === 0);
          return {
            ...prev,
            shootType: nextShoot,
            crewAssignments: shouldSeed ? [...EFP_LIVE_TEMPLATES] : (prev.crewAssignments || []),
          };
        });
      }}
      className="input"
    >
      <option value="">Shoot Type</option>
      <option value="Live">Live</option>
      <option value="EFP">EFP</option>
      <option value="B-roll">B-roll Only</option>
      <option value="ENG">ENG</option>
    </select>

    {/* 👉 NEW: EFP/Live Crew Assignments (TicketPage will show in expanded view) */}
    {(formData.shootType === "EFP" || formData.shootType === "Live") && (
      <div className="rounded-xl border p-4 space-y-4">
        <div className="font-semibold">Crew Assignments (EFP/Live)</div>
        <p className="text-sm text-gray-600">
          These roles will appear in the <span className="font-medium">expanded view</span> of the ticket.
          You can assign multiple people per role and add custom roles.
        </p>

        <div className="space-y-3">
          {(formData.crewAssignments || []).map((row, idx) => (
            <div key={`${row.role}-${idx}`} className="grid md:grid-cols-2 gap-3">
              <div className="flex items-center">
                <label className="mr-3 min-w-32 font-medium">{row.role}</label>
              </div>
              <MultiSelectCombobox
                options={userOptionsCrew}
                selected={Array.isArray(row.assignees) ? row.assignees : []}
                onChange={(next) => {
                  const values = (next || [])
                    .map((v) => (typeof v === "string" ? v : v?.value))
                    .filter(Boolean);
                  setFormData((prev) => {
                    const arr = Array.isArray(prev.crewAssignments) ? [...prev.crewAssignments] : [];
                    const i = arr.findIndex((r) => r.role === row.role);
                    if (i >= 0) arr[i] = { ...arr[i], assignees: values };
                    return { ...prev, crewAssignments: arr };
                  });
                }}
                placeholder="Assign team members…"
              />
            </div>
          ))}

          {/* Add custom role */}
          <AddCustomCrewRole
            onAdd={(roleName) => {
              const role = String(roleName || "").trim();
              if (!role) return;
              setFormData((prev) => {
                const arr = Array.isArray(prev.crewAssignments) ? [...prev.crewAssignments] : [];
                const exists = arr.some((r) => r.role.toLowerCase() === role.toLowerCase());
                if (!exists) arr.push({ role, assignees: [] });
                return { ...prev, crewAssignments: arr };
              });
            }}
          />
        </div>
      </div>
    )}
  </div>
)}

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
          >Submit Request</button>
        </form>
      )}

      {/* === Show Only 7 Most Recent Tickets (Better Layout + Status + See More) === */}
      {showRecent && (
        <div className="mt-10 bg-white p-4 rounded-lg shadow space-y-2">
          <h2 className="text-lg font-semibold mb-2">Recent Request Forms</h2>
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

function AddCustomCrewRole({ onAdd }) {
  const [roleName, setRoleName] = useState("");
  return (
    <div className="grid md:grid-cols-2 gap-3 items-center">
      <input
        type="text"
        value={roleName}
        onChange={(e) => setRoleName(e.target.value)}
        placeholder="Add custom role (e.g., VT Operator)"
        className="input"
      />
      <button
        type="button"
        className="px-3 py-2 bg-gray-100 rounded-md border hover:bg-gray-200"
        onClick={() => {
          const val = roleName.trim();
          if (!val) return;
          onAdd(val);
          setRoleName("");
        }}
      >
        Add Role
      </button>
    </div>
  );
}

export default TicketForm;


