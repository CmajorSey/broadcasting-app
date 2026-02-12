import React, { useState, useEffect, useRef } from "react";
import { Trash2, Pencil, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";
import DutyBadge from "@/components/DutyBadge";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast";


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

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

import { Badge } from "@/components/ui/badge";

// (removed duplicate helpers – single source of truth lives above)


// === Duty/Roster helpers (added) ===
function getWeekStart(dateISO) {
  const d = new Date(dateISO);
  if (isNaN(d.getTime())) return "";
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // force Monday start
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function getHourForBadges(dateISO, filmingTime) {
  try {
    // Prefer explicit filmingTime "HH:MM" if present
    if (filmingTime && /^\d{2}:\d{2}/.test(filmingTime)) {
      const h = parseInt(filmingTime.split(":")[0], 10);
      if (Number.isFinite(h)) return h;
    }
    // Fallback to hour from the ticket filming date/time
    const d = new Date(dateISO);
    if (!isNaN(d.getTime())) return d.getHours();
  } catch {}
  return 0;
}

/* ===========================
   🗓️ Date formatting (DD/MM/YYYY)
   =========================== */
function formatDDMMYYYY(isoLike) {
  try {
    const d = new Date(String(isoLike || ""));
    if (isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return "";
  }
}

function formatDDMMYYYY_HHMM(isoLike) {
  try {
    const d = new Date(String(isoLike || ""));
    if (isNaN(d.getTime())) return "";
    const ddmmyyyy = formatDDMMYYYY(d);
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return ddmmyyyy ? `${ddmmyyyy}, ${hh}:${min}` : "";
  } catch {
    return "";
  }
}

export default function TicketPage({ users, vehicles, loggedInUser }) {
  const [tickets, setTickets] = useState([]);

  const { toast } = useToast();

  /* ===========================
     🔔 TicketPage local alerts
     RULES:
     - TicketPage edits (the actor = you) -> toast confirmation only, NO sound here.
     - Still emit the ticket event so App.jsx can notify other users (toast/sound) as needed.
     - Global preferences (toasts/sounds) are controlled elsewhere (App / Settings / MyProfile).
     =========================== */

 const emitTicketEvent = (payload) => {
  try {
    // Normalize shape so App.jsx can reliably read:
    // - detail.ticket
    // - detail.actor
    // - detail.ts / detail.timestamp
    const detail = {
      ...payload,
      category: payload?.category || "ticket",
      ts: payload?.ts || Date.now(),
      timestamp:
        payload?.timestamp ||
        (payload?.ts ? new Date(payload.ts).toISOString() : new Date().toISOString()),
    };

    window.dispatchEvent(
      new CustomEvent("loBoard:ticketEvent", { detail })
    );
  } catch {
    // ignore (older browsers / safety)
  }
};

  const navigate = useNavigate();

  const fireTicketAlert = async ({
    title,
    message,
    urgent = false,
    action = "Updated",
    ticketId,
    extra = {},
    // ✅ allow callers (or future global listeners) to override where the toast click should go
    actionUrl = "/tickets",
  }) => {
    const actor = loggedInUser?.name || "Unknown";

    const ticket =
      extra?.ticket ||
      extra?.updatedTicket ||
      extra?.newTicket ||
      null;

    emitTicketEvent({
      category: "ticket",
      action,
      title,
      message,
      ticketId,
      actor,
      ticket,
      ts: Date.now(),
      actionUrl,
      ...extra,
    });

    const toastEnabled =
      localStorage.getItem("notificationToastsEnabled") !== "false";

    // ✅ Click guard: ignore clicks on the toast close button (or any button)
    const shouldIgnoreToastClick = (evt) => {
      try {
        const el = evt?.target;
        if (!el) return false;
        if (typeof el.closest === "function" && el.closest("button")) return true;
        return false;
      } catch {
        return false;
      }
    };

    if (toastEnabled) {
      toast({
        title: title || "Request update",
        description: message || "",
        variant: urgent ? "destructive" : undefined,
        duration: 4500,
        className: "cursor-pointer",

        // ✅ CLICKING TOAST REDIRECTS TO TICKET PAGE (and ignores the close button)
        onClick: (evt) => {
          if (shouldIgnoreToastClick(evt)) return;
          navigate(actionUrl || "/tickets");
        },
      });
    }
  };
  // 🔊 Sound settings ends here

  // Sorting state for "Filming Date & Time"
  // true = ascending (oldest → newest), false = descending (newest → oldest)
  const [filmSortAsc, setFilmSortAsc] = useState(true);
  const rosterCache = useRef({});

  /* ===========================
     🗓️ Public holidays (for PH badge + Admin Stats feed)
     - Pulls from backend: GET /holidays
     - Stores a quick lookup Set of "YYYY-MM-DD"
     - Enriches tickets with:
       - isPublicHoliday: boolean
       - publicHolidayName: string
     =========================== */
  const [holidays, setHolidays] = useState([]); // [{ date:"YYYY-MM-DD", name }]
  const holidaySetRef = useRef(new Set());

  // ✅ Optional: quick name lookup for Admin Stats / UI
  const getHolidayName = (dateISO) => {
    const day = String(dateISO || "").slice(0, 10);
    if (!day) return "";
    const hit = (Array.isArray(holidays) ? holidays : []).find(
      (h) => String(h?.date || "").slice(0, 10) === day
    );
    return String(hit?.name || "").trim();
  };

  useEffect(() => {
    holidaySetRef.current = new Set(
      (Array.isArray(holidays) ? holidays : [])
        .map((h) => String(h?.date || "").slice(0, 10))
        .filter(Boolean)
    );

    // ✅ Feed stats / other consumers: enrich tickets in-state (non-destructive)
    setTickets((prev) =>
      (Array.isArray(prev) ? prev : []).map((t) => {
        const day = String(t?.date || "").slice(0, 10);
        const isPH = day && holidaySetRef.current.has(day);
        const name = isPH ? getHolidayName(day) : "";

        const alreadyHasPH = typeof t?.isPublicHoliday === "boolean";
        const alreadyHasName = typeof t?.publicHolidayName === "string";

        // Preserve backend values if already present
        const next = { ...t };
        if (!alreadyHasPH) next.isPublicHoliday = !!isPH;
        if (!alreadyHasName) next.publicHolidayName = name || "";

        return next;
      })
    );
  }, [holidays]);

  const isPublicHoliday = (dateISO) => {
    const day = String(dateISO || "").slice(0, 10);
    if (!day) return false;
    return holidaySetRef.current.has(day);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/holidays`, { credentials: "include" });
        if (!res.ok) throw new Error(`GET /holidays failed (${res.status})`);
        const data = await res.json().catch(() => []);
        if (!cancelled) setHolidays(Array.isArray(data) ? data : []);
      } catch (err) {
        console.warn("TicketPage: could not load holidays (non-blocking):", err);
        if (!cancelled) setHolidays([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchRosterForDate(dateISO) {
    const weekStart = getWeekStart(dateISO);
    if (!weekStart) return [];
    if (rosterCache.current[weekStart]) {
      return rosterCache.current[weekStart];
    }
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
    // Expect "YYYY-MM-DD"; still guard with slice for safety
    const week = await fetchRosterForDate(dateOnlyISO);
    const day = week.find(
      (d) => d?.date?.slice(0, 10) === String(dateOnlyISO).slice(0, 10)
    );

    // Normalize to the three groups TicketPage expects: off, afternoonShift, primary
    if (!day) return { off: [], afternoonShift: [], primary: [] };

    // --- Helpers to normalize names from strings/arrays/objects ---
    const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    const extractNames = (list) => {
      const arr = toArray(list);
      const names = [];
      for (const item of arr) {
        if (!item) continue;
        if (typeof item === "string") {
          // also support comma-separated strings
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

    // Operations can store cam-ops in a few places; check common shapes
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



      // Duty badges driven by Operations roster + time.
  // Shows:
  // - Off Duty (always wins)
  // - Directing News if on primary AND filming time is >= 12:00
  // - Afternoon Shift if on afternoonShift AND filming time is < 12:00
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

    // Normalize names for robust comparison:
    // - trim, lowercase
    // - drop common role prefixes ("camop:", "journalist:", "producer:")
    // - collapse multiple spaces
    const normalizeName = (val) => {
      const s = String(val || "")
        .replace(/^\s*(cam\s*op|camop|journalist|sports\s*journalist|producer)\s*:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return s;
    };

    const list = Array.isArray(names) ? names : [];
    const has = (arr, name) => {
      if (!Array.isArray(arr)) return false;
      const target = normalizeName(name);
      return arr.some((n) => normalizeName(n) === target);
    };

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
            <div key={i} className="flex items-center justify-center gap-2">
              <span>{name}</span>
              {badge}
            </div>
          );
        })}
      </div>
    );
  }

  // ===== ID-based UI State =====
const [selectedCurrentIds, setSelectedCurrentIds] = useState([]);
const [selectedArchivedIds, setSelectedArchivedIds] = useState([]);
const [selectedDeletedIds, setSelectedDeletedIds] = useState([]);

// Technical table selection
const [selectedTechIds, setSelectedTechIds] = useState([]);

const [showSelectBoxes, setShowSelectBoxes] = useState(false);
const [showRecycleModal, setShowRecycleModal] = useState(false);
const [showRestoreModal, setShowRestoreModal] = useState(false);
const [showPermanentDeleteModal, setShowPermanentDeleteModal] = useState(false);

const [editingId, setEditingId] = useState(null);
const [editData, setEditData] = useState(null);
const [newNotes, setNewNotes] = useState({});

// Current table expand (Filming)
const [expandedIds, setExpandedIds] = useState([]);
const [expandAll, setExpandAll] = useState(false);

// Technical table expand
const [techExpandedIds, setTechExpandedIds] = useState([]);
const [techExpandAll, setTechExpandAll] = useState(false);

// Technical table search
const [techSearch, setTechSearch] = useState("");


// Archived table UI (search/filter/expand)
const [archSearch, setArchSearch] = useState("");
const [archStatus, setArchStatus] = useState("all"); // all | Unassigned | Assigned | In Progress | Completed | Postponed | Cancelled
const [archType, setArchType] = useState("all");      // all | filming | technical
const [archExpandedIds, setArchExpandedIds] = useState([]);

// Archives sorting + date filters
const [archSortAsc, setArchSortAsc] = useState(true);        // true=oldest→newest
const [archDateFilter, setArchDateFilter] = useState("all"); // all | today | week | last_month | day
const [archSpecificDay, setArchSpecificDay] = useState("");  // YYYY-MM-DD when archDateFilter === "day"


const isAdmin = loggedInUser?.roles?.includes("admin");

  const isProducer = loggedInUser?.roles?.includes("producer");
  const isDriver = loggedInUser?.roles?.includes("driver");
  const [showArchived, setShowArchived] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const canEditAny =
    isAdmin || isProducer || loggedInUser?.roles?.includes("journalist");
  const canEditVehicle = isAdmin || isProducer || isDriver;
  const canAddNotes = isAdmin || isDriver;

  const handleStatusChange = async (ticketId, newStatus) => {
    const before = tickets.find((t) => String(t.id) === String(ticketId));
    const beforeStatus = before?.assignmentStatus || "Unassigned";

    // ✅ Optimistic UI
    setTickets((prev) =>
      prev.map((t) =>
        String(t.id) === String(ticketId)
          ? { ...t, assignmentStatus: newStatus }
          : t
      )
    );

    try {
      const res = await fetch(`${API_BASE}/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentStatus: newStatus }),
      });

      if (!res.ok) throw new Error("Failed to update status");

      const updated = await res.json();
      setTickets((prev) =>
        prev.map((t) => (String(t.id) === String(ticketId) ? updated : t))
      );

           await fireTicketAlert({
        title: "Request status updated",
        message: `${before?.title || "Ticket"}: ${beforeStatus} → ${newStatus}`,
        action: "StatusChanged",
        ticketId,
        extra: { ticket: updated }, // ✅ gives App.jsx detail.ticket
      });
    } catch (err) {
      console.error("Error updating status:", err);

      // rollback
      setTickets((prev) =>
        prev.map((t) =>
          String(t.id) === String(ticketId)
            ? { ...t, assignmentStatus: beforeStatus }
            : t
        )
      );

      await fireTicketAlert({
        title: "Could not update status",
        message: "Please try again.",
        urgent: true,
        action: "StatusChangeFailed",
        ticketId,
      });
    }
  };

  // ===== Fallback users fetch if the `users` prop is empty =====
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [usersLoadError, setUsersLoadError] = useState(null);

  useEffect(() => {
    if (users && users.length > 0) {
      setRemoteUsers([]);
      setUsersLoadError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/users`, { method: "GET" });
        const raw = await res.json().catch(() => []);
        const arr = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.users)
          ? raw.users
          : [];
        if (!cancelled) setRemoteUsers(arr);
      } catch (err) {
        console.error("❌ Failed to fetch users:", err);
        if (!cancelled) setUsersLoadError(err?.message || "Unknown error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [users]);

  // Unified users source
  const effectiveUsers = users && users.length > 0 ? users : remoteUsers;

  // Helpers
  const toLowerRoles = (u) =>
    (Array.isArray(u?.roles) ? u.roles : [u?.role]).map((r) =>
      String(r || "").toLowerCase()
    );
  const nameOf = (u) => String(u?.name || "").trim();

  // Driver options
  const driverOptions = (effectiveUsers || []).filter((u) => {
    const rl = toLowerRoles(u);
    return rl.includes("driver") || rl.includes("driver_limited");
  });

  // CamOps options with dividers
  const camOpsOnly = [];
  const camOpsProducers = [];
  const camOpsAdmins = [];

  (effectiveUsers || []).forEach((u) => {
    const rl = toLowerRoles(u);
    const nm = nameOf(u);
    if (!nm) return;
    if (!rl.includes("camop")) return;

    const isProducerUser = rl.includes("producer");
    const isAdminUser = rl.includes("admin");

    if (isAdminUser) camOpsAdmins.push(nm);
    else if (isProducerUser) camOpsProducers.push(nm);
    else camOpsOnly.push(nm);
  });

  camOpsOnly.sort();
  camOpsProducers.sort();
  camOpsAdmins.sort();

  const camOpOptionsWithDividers = [
    ...camOpsOnly.map((name) => ({ label: name, value: name })),
    { label: "––––––––", value: "__divider1", divider: true },
    ...camOpsProducers.map((name) => ({ label: name, value: name })),
    { label: "––––––––", value: "__divider2", divider: true },
    ...camOpsAdmins.map((name) => ({ label: name, value: name })),
  ];
  const camOpOptionsDecorated = camOpOptionsWithDividers;

  // Reporter options (journalists / sports_journalist / producers) with dividers
  const reportersJournalists = [];
  const reportersSports = [];
  const reportersProducers = [];

  (effectiveUsers || []).forEach((u) => {
    const rl = toLowerRoles(u);
    const nm = nameOf(u);
    if (!nm) return;

    if (rl.includes("journalist")) reportersJournalists.push(nm);
    else if (rl.includes("sports_journalist")) reportersSports.push(nm);
    else if (rl.includes("producer")) reportersProducers.push(nm);
  });

  reportersJournalists.sort();
  reportersSports.sort();
  reportersProducers.sort();

  const reporterOptionsWithDividers = [
    ...reportersJournalists.map((name) => ({ label: name, value: name })),
    { label: "––––––––", value: "__rep_div1", divider: true },
    ...reportersSports.map((name) => ({ label: name, value: name })),
    { label: "––––––––", value: "__rep_div2", divider: true },
    ...reportersProducers.map((name) => ({ label: name, value: name })),
  ];
  const reporterOptionsDecorated = reporterOptionsWithDividers;

  // Tickets fetch
  useEffect(() => {
    fetch(`${API_BASE}/tickets`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch tickets");
        return await res.json();
      })
      .then((data) => {
        setTickets(data);
      })
      .catch((err) => {
        console.error("Failed to fetch tickets:", err);
        setTickets([]);
      });
  }, []);

  // ===== Editing helpers (by ID) =====

  /**
   * ✅ Backend notification emit (Fleet-style)
   *
   * ⚠️ IMPORTANT (v0.8.x):
   * TicketPage already emits a `loBoard:ticketEvent` via `fireTicketAlert()`.
   * App.jsx listens for that event and is responsible for creating/pushing the
   * notification (and handling dedupe globally).
   *
   * If TicketPage ALSO POSTs to `/notifications`, the same action can be sent twice,
   * resulting in duplicate FCM pushes / duplicate inbox items.
   *
   * So this function is intentionally a NO-OP for TicketPage.
   * (We keep the function to preserve existing call sites + avoid refactors.)
   */
  const sendTicketPageNotification = async ({
    title,
    message,
    urgent = false,
    ticket,
    category = "tickets",
    action = "ticket_updated",
  }) => {
    try {
      // ✅ Disabled to prevent duplicate tokens/pushes.
      // TicketPage uses `fireTicketAlert()` -> emits event -> App.jsx handles notifications.
      return;
    } catch (err) {
      // Never break TicketPage if notifications fail
      console.warn("TicketPage notification skipped (non-blocking):", err);
    }
  };

  const startEditing = (ticketOrId) => {
    const id = typeof ticketOrId === "string" ? ticketOrId : ticketOrId?.id;
    const ticket = tickets.find((t) => String(t.id) === String(id));
    if (!ticket) return;

    let autoDriver = ticket.assignedDriver || "";

    // Nelson logic
    const nelson = driverOptions.find(
      (u) => u.name === "Nelson Joseph" && !u.isOff
    );
    if (!autoDriver && nelson) {
      autoDriver = "Nelson Joseph";
    }

    const stripRolePrefix = (s) =>
      String(s || "")
        .replace(
          /^\s*(?:Journalist|Sports\s*Journalist|Producer)\s*:\s*/i,
          ""
        )
        .trim();

    const normalizedReporter = Array.from(
      new Set(
        (Array.isArray(ticket.assignedReporter)
          ? ticket.assignedReporter
          : typeof ticket.assignedReporter === "string" &&
            ticket.assignedReporter.trim()
          ? [ticket.assignedReporter]
          : []
        )
          .map(stripRolePrefix)
          .filter(Boolean)
      )
    );

    setEditingId(ticket.id);
    setEditData({
      ...ticket,
      // Main driver (TO)
      assignedDriver: autoDriver,
      // Always keep Return (FROM) same as TO by default
      assignedDriverFrom: autoDriver,
      // Optional: additional drivers for extra vehicles
      additionalDrivers: Array.isArray(ticket.additionalDrivers)
        ? [...ticket.additionalDrivers]
        : [],
      assignedCamOps: ticket.assignedCamOps || [],
      assignedReporter: normalizedReporter,
      vehicle: ticket.vehicle || "",
      priority: ticket.priority || "Normal",
      assignmentStatus: ticket.assignmentStatus || "Pending",
      departureTime: ticket.departureTime?.slice(0, 5) || "",
      filmingTime: ticket.filmingTime?.slice(0, 5) || "",
      location: ticket.location || "",
      title: ticket.title || "",
    });
  };

  const saveEditing = async () => {
    if (!editingId || !editData) return;
    const original = tickets.find((t) => String(t.id) === String(editingId));
    if (!original) return;

    const stripRolePrefix = (s) =>
      String(s || "")
        .replace(/^\s*(?:Journalist|Sports\s*Journalist|Producer)\s*:\s*/i, "")
        .trim();

    const sourceReporter =
      typeof editData.assignedReporter !== "undefined"
        ? editData.assignedReporter
        : original.assignedReporter;

    const reporterArray = Array.from(
      new Set(
        (Array.isArray(sourceReporter)
          ? sourceReporter
          : typeof sourceReporter === "string" && sourceReporter.trim()
          ? [sourceReporter]
          : []
        )
          .map(stripRolePrefix)
          .filter(Boolean)
      )
    );

    const unique = (arr) =>
      Array.from(
        new Set(
          (arr || [])
            .map((s) => String(s || "").trim())
            .filter(Boolean)
        )
      );

      const updatedTicket = {
      id: original.id,
      title: editData.title || original.title,
      date: editData.date || original.date,
      location: editData.location || original.location,
      filmingTime: editData.filmingTime || original.filmingTime,
      departureTime: editData.departureTime || original.departureTime,

      assignedCamOps: editData.assignedCamOps || original.assignedCamOps || [],

      // Primary driver (TO location)
      assignedDriver: editData.assignedDriver || original.assignedDriver || "",

      // Return driver (FROM location)
      assignedDriverFrom:
        editData.assignedDriverFrom || original.assignedDriverFrom || "",

      // Additional drivers (extra vehicles)
      additionalDrivers: unique(
        Array.isArray(editData.additionalDrivers)
          ? editData.additionalDrivers
          : Array.isArray(original.additionalDrivers)
          ? original.additionalDrivers
          : []
      ),

      assignedReporter: reporterArray,
      vehicle: editData.vehicle || original.vehicle || "",
      assignmentStatus:
        editData.assignmentStatus || original.assignmentStatus || "Unassigned",
      priority: editData.priority || original.priority || "Normal",
      assignedBy: loggedInUser?.name || "Unknown",

      // ✅ PH fields for Admin Stats (computed from the chosen date)
      isPublicHoliday: isPublicHoliday(editData.date || original.date),
      publicHolidayName: (isPublicHoliday(editData.date || original.date) ? getHolidayName(editData.date || original.date) : "") || "",
    };

    if (
      updatedTicket.assignmentStatus === "Unassigned" &&
      updatedTicket.assignedDriver &&
      updatedTicket.assignedCamOps.length > 0
    ) {
      updatedTicket.assignmentStatus = "Assigned";
    }

    // ✅ Optimistic UI by id
    setTickets((prev) =>
      prev.map((t) =>
        String(t.id) === String(editingId) ? { ...t, ...updatedTicket } : t
      )
    );

    try {
      const res = await fetch(`${API_BASE}/tickets/${updatedTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedTicket),
      });
      if (!res.ok) throw new Error(`Failed to update ticket (HTTP ${res.status})`);

      // Refetch to stay canonical with backend
      const refreshed = await fetch(`${API_BASE}/tickets`);
      const data = await refreshed.json();
      setTickets(data);
      setEditingId(null);
      setEditData(null);

          // ✅ Backend notification feed (so OTHER tabs can react via App.jsx poller)
        await sendTicketPageNotification({
        title: "Request updated",
        message: updatedTicket.title || "Changes saved.",
        urgent: false,
        ticket: updatedTicket,
        category: "tickets",
      });

      // ✅ Local/global emit (same-tab + same-origin broadcast)
         await fireTicketAlert({
        title: "Request updated",
        message: updatedTicket.title || "Changes saved.",
        action: "Updated",
        ticketId: updatedTicket.id,
        extra: { ticket: updatedTicket }, // ✅ gives App.jsx detail.ticket
      });
    } catch (err) {
      console.error("Failed to save ticket edits:", err);

      // Try to refetch & reset UI
      try {
        const refreshed = await fetch(`${API_BASE}/tickets`);
        const data = await refreshed.json();
        setTickets(data);
        setEditingId(null);
        setEditData(null);
      } catch (refetchErr) {
        console.error("Refetch after failed save also errored:", refetchErr);
      }

           // ✅ Backend notification feed (so OTHER tabs can react via App.jsx poller)
      await sendTicketPageNotification({
        title: "Failed to save changes",
        message: "Please try again.",
        urgent: true,
        ticket: updatedTicket,
        category: "tickets",
      });

      // ✅ Local/global emit (same-tab + same-origin broadcast)
      await fireTicketAlert({
        title: "Failed to save changes",
        message: "Please try again.",
        urgent: true,
        action: "UpdateFailed",
        ticketId: updatedTicket.id,
      });
    }
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditData(null);
  };

  // ===== Selection / Expansion helpers (ID-based) =====
  const currentTickets = tickets.filter((t) => !t.deleted && !t.archived);

  // Filming vs Technical (active only)
  const filmingCurrent = currentTickets.filter((t) =>
    t.type !== "Technical"
  );
  const technicalCurrent = currentTickets.filter((t) =>
    t.type === "Technical"
  );


  const toggleSelect = (id) => {
    setSelectedCurrentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedCurrentIds.length === currentTickets.length) {
      setSelectedCurrentIds([]);
    } else {
      setSelectedCurrentIds(currentTickets.map((t) => t.id));
    }
  };

  const toggleRow = (id) => {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleExpandAll = () => {
    if (expandAll) {
      setExpandedIds([]);
      setExpandAll(false);
    } else {
      setExpandedIds(currentTickets.map((t) => t.id));
      setExpandAll(true);
    }
  };

  // ===== Notes (by ID) =====
    const handleAddNote = async (ticketId) => {
    const text = newNotes[ticketId];
    if (!text || !text.trim()) return;

    const timestamp = new Date().toLocaleString();
    const target = tickets.find((t) => String(t.id) === String(ticketId));
    if (!target) return;

    const nextNotes = Array.isArray(target.notes) ? [...target.notes] : [];
    const newNote = {
      text: text.trim(),
      author: loggedInUser?.name || "Unknown",
      timestamp,
    };
    nextNotes.push(newNote);

    try {
      const res = await fetch(`${API_BASE}/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: nextNotes }),
      });

      if (!res.ok) throw new Error("Failed to add note");

      setTickets((prev) =>
        prev.map((t) =>
          String(t.id) === String(ticketId) ? { ...t, notes: nextNotes } : t
        )
      );
      setNewNotes((prev) => ({ ...prev, [ticketId]: "" }));

          // ✅ Backend notification feed (so OTHER tabs can react via App.jsx poller)
await sendTicketPageNotification({
  title: "Note added to Request",
  message: `${target.title || "Request"}: ${newNote.text}`,
  urgent: false,
  ticket: { ...target, notes: nextNotes },
  category: "tickets",
  action: "ticket_note_added",
});
  
// ✅ Local/global emit (same-tab + same-origin broadcast)
await fireTicketAlert({
  title: "Note added",
  message: `${target.title || "Ticket"}: ${newNote.text}`,
  action: "NoteAdded",
  ticketId,
  extra: { ticket: { ...target, notes: nextNotes } }, // ✅ rich payload
});
} catch (err) {
console.error("Failed to add note:", err);

    // ✅ Backend notification feed (so OTHER tabs can react via App.jsx poller)
await sendTicketPageNotification({
  title: "Could not add note",
  message: "Please try again.",
  urgent: true,
  ticket: target,
  category: "tickets",
  action: "ticket_note_add_failed",
});

      // ✅ Local/global emit (same-tab + same-origin broadcast)
      await fireTicketAlert({
        title: "Could not add note",
        message: "Please try again.",
        urgent: true,
        action: "NoteAddFailed",
        ticketId,
      });
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">All Requests</h2>

      <div className="flex flex-wrap items-center mb-2 gap-2">
        <button
          onClick={() => {
            setShowSelectBoxes(!showSelectBoxes);
            setSelectedCurrentIds([]);
          }}
          className="px-3 py-1 border rounded"
        >
          {showSelectBoxes ? "Hide Selection" : "Select Requests"}
        </button>
        {showSelectBoxes && (
          <button onClick={toggleSelectAll} className="px-3 py-1 border rounded">
            {selectedCurrentIds.length === currentTickets.length
              ? "Deselect All"
              : "Select All"}
          </button>
        )}
        <button onClick={toggleExpandAll} className="px-3 py-1 border rounded">
          {expandAll ? "Collapse All" : "Expand All"}
        </button>
      </div>

      {selectedCurrentIds.length > 0 && (
        <div className="flex gap-2 mb-2">
          <button
            onClick={async () => {
              try {
                const toArchive = tickets.filter(
                  (t) =>
                    !t.deleted &&
                    !t.archived &&
                    selectedCurrentIds.includes(t.id)
                );

                for (const ticket of toArchive) {
                  await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ archived: true }),
                  });
                }

                const res = await fetch(`${API_BASE}/tickets`);
                const updated = await res.json();
                setTickets(updated);
                setSelectedCurrentIds([]);
              } catch (err) {
                console.error("Failed to archive tickets:", err);
              }
            }}
            className="text-yellow-600 border border-yellow-600 hover:bg-yellow-100 px-3 py-1 rounded-md transition"
          >
            Send to Archives
          </button>

          <button
            onClick={() => setShowRecycleModal(true)}
            className="text-red-500 border border-red-500 hover:bg-red-100 px-3 py-1 rounded-md transition"
          >
            Send to Recycle Bin
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
  <table className="min-w-full text-sm border border-gray-300 table-fixed">
          <thead className="bg-blue-800 text-white">
  <tr>
    {showSelectBoxes && <th className="p-2 text-center">Select</th>}

    {/* Title */}
<th className="px-2 py-1 text-center text-xs font-semibold">Request</th>

{/* Filming Date & Time — clickable sort header */}
<th
  className="px-2 py-1 text-center text-xs font-semibold select-none cursor-pointer"
  onClick={() => setFilmSortAsc((v) => !v)}
  title="Sort by Filming Date & Time"
>
  <div className="inline-flex items-center justify-center gap-2">
    <span>Filming Date &amp; Time</span>
    <span aria-hidden="true">{filmSortAsc ? "▲" : "▼"}</span>
  </div>
</th>

{/* Departure Time */}
<th className="px-2 py-1 text-center text-xs font-semibold">Departure Time</th>

{/* Location */}
<th className="px-2 py-1 text-center text-xs font-semibold">Location</th>

{/* Cam Ops */}
<th className="px-2 py-1 text-center text-xs font-semibold">Cam Ops</th>

{/* Driver */}
<th className="px-2 py-1 text-center text-xs font-semibold">Driver</th>

{/* Assigned Reporter */}
<th className="px-2 py-1 text-center text-xs font-semibold">Journalist / Producer</th>

{/* Status */}
<th className="px-2 py-1 text-center text-xs font-semibold">Status</th>

{/* Actions */}
<th className="px-2 py-1 text-center text-xs font-semibold">Actions</th>

  </tr>
</thead>


          <tbody>
                       {filmingCurrent
  .slice()
  .sort((a, b) => {
    // safe getters
    const isoA = String(a?.date || "").trim();
    const isoB = String(b?.date || "").trim();

    const dateA = isoA.slice(0, 10); // "YYYY-MM-DD"
    const dateB = isoB.slice(0, 10);

    // Primary: compare date (missing sorts last)
    if (dateA !== dateB) {
      const cmpDate =
        !dateA ? 1 :
        !dateB ? -1 :
        dateA < dateB ? -1 : 1;
      return filmSortAsc ? cmpDate : -cmpDate;
    }

    // Secondary: compare time (prefer explicit filmingTime "HH:mm")
    const timeFromISO = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    };

    const normTime = (t) => (/^\d{2}:\d{2}$/.test(String(t || "")) ? t : "");

    const timeA =
      normTime(a?.filmingTime) || timeFromISO(isoA) || "";
    const timeB =
      normTime(b?.filmingTime) || timeFromISO(isoB) || "";

    if (timeA !== timeB) {
      // Rows with a valid time come before rows without a time on same date
      const cmpTime =
        !timeA ? 1 :
        !timeB ? -1 :
        timeA < timeB ? -1 : 1;
      return filmSortAsc ? cmpTime : -cmpTime;
    }

    return 0;
  })
  .map((ticket, rowIdx) => {
              const isEditing = editingId === ticket.id;
              const isExpanded = expandedIds.includes(ticket.id);

              return (
                <React.Fragment key={ticket.id}>
                  <tr
                    className={`${
                      rowIdx % 2 === 0 ? "bg-white" : "bg-gray-50"
                    } border-b ${
                      ticket.priority === "Urgent"
                        ? "border-l-4 border-l-red-600"
                        : ticket.shootType === "Live"
                        ? "border-l-4 border-l-blue-600"
                        : "border-l"
                    }`}
                  >
                    {showSelectBoxes && (
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={selectedCurrentIds.includes(ticket.id)}
                          onChange={() => toggleSelect(ticket.id)}
                        />
                      </td>
                    )}

                    {/* Title */}
<td className="px-2 py-1 text-center align-middle">
  {isEditing ? (
    <input
      type="text"
      value={editData?.title || ""}
      onChange={(e) =>
        setEditData((d) => ({
          ...d,
          title: e.target.value,
        }))
      }
      className="border px-2 py-1 rounded w-full"
    />
  ) : (
    <div className="flex items-center justify-center gap-2">
      <div className="truncate max-w-[160px]">{ticket.title}</div>
      {(ticket.camCount > 1 || ticket.expectedCamOps > 1) && (
        <Badge variant="secondary" className="text-[10px]">
          👤{ticket.expectedCamOps || 1}🎥{ticket.camCount || 1}
        </Badge>
      )}
    </div>
  )}
</td>


                    {/* Filming Date & Time */}
                    <td className="p-2 text-center whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="datetime-local"
                          value={editData?.date?.slice(0, 16) || ""}
                          onChange={(e) =>
                            setEditData((d) => ({
                              ...d,
                              date: e.target.value,
                            }))
                          }
                          className="border px-2 py-1 rounded"
                        />
                                    ) : (() => {
                          const filmingISO = ticket.date?.trim?.();
                          if (!filmingISO) return "-";

                          const label = formatDDMMYYYY_HHMM(filmingISO);
                          if (!label) {
                            console.warn("Invalid filming date format:", filmingISO);
                            return filmingISO;
                          }

                          const ph = isPublicHoliday(filmingISO);

                          return (
                            <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
                              <span>{label}</span>
                              {ph ? (
                                <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                                  (PH)
                                </Badge>
                              ) : null}
                            </div>
                          );
                        })()}
                    </td>

                    {/* Departure Time */}
                    <td className="p-2 text-center whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="time"
                          step="300"
                          value={editData?.departureTime || ""}
                          onChange={(e) =>
                            setEditData((d) => ({
                              ...d,
                              departureTime: e.target.value,
                            }))
                          }
                          className="border px-2 py-1 rounded"
                        />
                      ) : (
                        ticket.departureTime || "-"
                      )}
                    </td>

                    {/* Location */}
<td className="px-2 py-1 text-center align-middle">
  {isEditing ? (
    <input
      type="text"
      value={editData?.location || ""}
      onChange={(e) =>
        setEditData((d) => ({
          ...d,
          location: e.target.value,
        }))
      }
      className="border px-2 py-1 rounded w-full"
    />
  ) : (
    <div className="truncate max-w-[140px] mx-auto">{ticket.location || "-"}</div>
  )}
</td>


                    {/* Cam Ops */}
                    <td className="p-2 text-center whitespace-nowrap">
                      {isEditing ? (
                        <MultiSelectCombobox
                          options={camOpOptionsDecorated}
                          selected={editData?.assignedCamOps || []}
                          onChange={(next) => {
                            const values = (next || [])
                              .map((v) =>
                                typeof v === "string" ? v : v?.value
                              )
                              .filter(
                                (val) =>
                                  val && !String(val).startsWith("__divider")
                              );
                            setEditData((prev) => ({
                              ...prev,
                              assignedCamOps: values,
                            }));
                          }}
                        />
                      ) : Array.isArray(ticket.assignedCamOps) &&
                        ticket.assignedCamOps.length > 0 ? (
                        <DutyBadgeWrapper
                          date={ticket.date}
                          filmingTime={ticket.filmingTime}
                          names={ticket.assignedCamOps}
                        />
                      ) : (
                        "-"
                      )}
                    </td>

                    {/* Driver */}
<td className="px-2 py-1 text-center align-middle">
  {isEditing ? (
    <div className="space-y-1">
      {/* Main driver (TO location) */}
      <div className="flex items-center justify-center gap-2">
        <label className="text-xs text-gray-600">Driver (TO):</label>
        <select
          value={editData?.assignedDriver || ""}
          onChange={(e) => {
            const v = e.target.value;
            // Sync FROM with TO automatically on every TO change
            setEditData((d) => ({
              ...d,
              assignedDriver: v,
              assignedDriverFrom: v,
            }));
          }}
          className="border px-2 py-1 rounded text-xs"
        >
          <option value="">Select Driver</option>
          {driverOptions.map((u) => (
            <option key={u.name} value={u.name}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* Return driver (FROM) — visible, but can be changed after */}
      <div className="flex items-center justify-center gap-2">
        <label className="text-xs text-gray-600">Return (FROM):</label>
        <select
          value={editData?.assignedDriverFrom || ""}
          onChange={(e) =>
            setEditData((d) => ({
              ...d,
              assignedDriverFrom: e.target.value,
            }))
          }
          className="border px-2 py-1 rounded text-xs"
        >
          <option value="">Select Return Driver</option>
          {driverOptions.map((u) => (
            <option key={u.name} value={u.name}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* Additional drivers (extra vehicles) */}
      <div className="space-y-1">
        {Array.isArray(editData?.additionalDrivers) &&
          editData.additionalDrivers.map((name, idx) => (
            <div key={idx} className="flex items-center justify-center gap-2">
              <label className="text-xs text-gray-600">
                Additional #{idx + 1}:
              </label>
              <select
                value={name || ""}
                onChange={(e) =>
                  setEditData((d) => {
                    const next = Array.isArray(d.additionalDrivers)
                      ? [...d.additionalDrivers]
                      : [];
                    next[idx] = e.target.value;
                    return { ...d, additionalDrivers: next };
                  })
                }
                className="border px-2 py-1 rounded text-xs"
              >
                <option value="">Select Driver</option>
                {driverOptions.map((u) => (
                  <option key={u.name} value={u.name}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-[11px] text-gray-600 underline"
                onClick={() =>
                  setEditData((d) => {
                    const next = (d.additionalDrivers || []).slice();
                    next.splice(idx, 1);
                    return { ...d, additionalDrivers: next };
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}

        <div className="text-[11px]">
          <button
            type="button"
            className="underline text-blue-600"
            onClick={() =>
              setEditData((d) => ({
                ...d,
                additionalDrivers: Array.isArray(d.additionalDrivers)
                  ? [...d.additionalDrivers, ""]
                  : [""],
              }))
            }
          >
            + Add driver
          </button>
        </div>
      </div>
    </div>
  ) : (
    // VIEW MODE: compact summary
    (() => {
      const main = ticket.assignedDriver || "";
      const ret = ticket.assignedDriverFrom || "";
      const extras = Array.isArray(ticket.additionalDrivers)
        ? ticket.additionalDrivers.filter(Boolean)
        : [];

      const parts = [];
      if (main) parts.push(main);
      if (ret && ret !== main) parts.push(`Return: ${ret}`);
      const extraCount = extras.filter((n) => n && n !== main && n !== ret).length;
      if (extraCount > 0) parts.push(`+${extraCount}`);

      const compact = parts.length ? parts.join(" • ") : "-";
      const fullList = [
        main && `To: ${main}`,
        ret && ret !== main && `From: ${ret}`,
        ...extras.filter(Boolean).map((n, i) => `Additional ${i + 1}: ${n}`),
      ]
        .filter(Boolean)
        .join(" | ");

      return (
        <div className="truncate max-w-[160px] mx-auto" title={fullList || ""}>
          {compact}
        </div>
      );
    })()
  )}
</td>

                    {/* Assigned Reporter */}
<td className="px-2 py-1 text-center align-middle">
  {isEditing ? (
    <MultiSelectCombobox
      options={reporterOptionsDecorated}
      selected={editData?.assignedReporter || []}
      onChange={(next) => {
        const stripRolePrefix = (s) =>
          String(s || "")
            .replace(
              /^\s*(?:Journalist|Sports\s*Journalist|Producer)\s*:\s*/i,
              ""
            )
            .trim();

        const values = Array.from(
          new Set(
            (next || [])
              .map((v) => (typeof v === "string" ? v : v?.value))
              .filter((val) => val && !String(val).startsWith("__rep_div"))
              .map(stripRolePrefix)
              .filter(Boolean)
          )
        );

        setEditData((prev) => ({
          ...prev,
          assignedReporter: values,
        }));
      }}
    />
  ) : Array.isArray(ticket.assignedReporter) && ticket.assignedReporter.length > 0 ? (
    <div className="truncate max-w-[160px] mx-auto">{ticket.assignedReporter.join(", ")}</div>
  ) : typeof ticket.assignedReporter === "string" && ticket.assignedReporter.trim() ? (
    <div className="truncate max-w-[160px] mx-auto">{ticket.assignedReporter}</div>
  ) : (
    "-"
  )}
</td>


                    {/* Status */}
                    <td className="p-2 text-center whitespace-nowrap">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button">
                            <Badge
                              variant={
                                ticket.assignmentStatus === "Completed"
                                  ? "success"
                                  : ticket.assignmentStatus === "In Progress"
                                  ? "secondary"
                                  : ticket.assignmentStatus === "Cancelled"
                                  ? "destructive"
                                  : ticket.assignmentStatus === "Postponed"
                                  ? "outline"
                                  : ticket.assignedCamOps?.length > 0
                                  ? "default"
                                  : "outline"
                              }
                              className="text-xs cursor-pointer"
                            >
                              {ticket.assignmentStatus ||
                                (ticket.assignedCamOps?.length > 0
                                  ? "Assigned"
                                  : "Unassigned")}
                            </Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[180px] p-2">
                          <div className="space-y-1">
                            {[
                              "Assigned",
                              "In Progress",
                              "Completed",
                              "Postponed",
                              "Cancelled",
                            ].map((status) => (
                              <div
                                key={status}
                                onClick={() =>
                                  handleStatusChange(ticket.id, status)
                                }
                                className="cursor-pointer px-2 py-1 hover:bg-accent rounded text-sm"
                              >
                                {status}
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </td>

                    {/* Actions */}
                    <td className="p-2 text-center whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-2 justify-center">
                          <button
                            className="text-green-600 hover:underline text-xs"
                            onClick={saveEditing}
                          >
                            Save
                          </button>
                          <button
                            className="text-gray-600 hover:underline text-xs"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2 justify-center">
                          {canEditAny && (
                            <button
                              className="text-blue-600 hover:underline text-xs"
                              onClick={() => startEditing(ticket.id)}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            className="text-yellow-600 hover:underline text-xs"
                            onClick={() => toggleRow(ticket.id)}
                          >
                            {isExpanded ? "Collapse" : "Expand"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {/* Expanded Row */}
{isExpanded && (
  <tr className="bg-gray-100">
    <td
      // Main table columns:
      // - Without Select: 9
      // - With Select: 10
      colSpan={showSelectBoxes ? 10 : 9}
      className="p-4 text-sm text-gray-700"
    >
      {/* FULL TITLE (expanded view) */}
      <div className="mb-3">
  <div className="font-bold text-gray-700">Request Title</div>
  <div className="text-base font-semibold leading-snug break-words">
    {ticket.title || "-"}
  </div>
</div>

<div className="mb-2 space-y-1">
  {ticket.type === "Technical" ? (
    <>
      <div>
        <span className="font-bold">Scope of Work:</span>{" "}
        {ticket.scopeOfWork || "-"}
      </div>
      <div>
        <span className="font-bold">Assigned Technicians:</span>{" "}
        {Array.isArray(ticket.assignedTechnicians) && ticket.assignedTechnicians.length > 0
          ? ticket.assignedTechnicians.join(", ")
          : "-"}
      </div>
      <div>
        <span className="font-bold">Location:</span>{" "}
        {ticket.location || "-"}
      </div>
    </>
  ) : (
    <>
          <div>
        <span className="font-bold">Filming Date:</span>{" "}
        {ticket.date ? formatDDMMYYYY(ticket.date) || "-" : "-"}
      </div>
      <div>
        <span className="font-bold">Filming Time:</span>{" "}
        {ticket.filmingTime || "-"}
      </div>
      <div>
        <span className="font-bold">Departure Time:</span>{" "}
        {ticket.departureTime || "-"}
      </div>
      <div>
        <span className="font-bold">Location:</span>{" "}
        {ticket.location || "-"}
      </div>
      <div>
        <span className="font-bold">Number of Cameras:</span>{" "}
        {ticket.camCount ?? "-"}
      </div>
      <div>
        <span className="font-bold">Cam Op Requirement:</span>{" "}
        {ticket.expectedCamOps
          ? `${ticket.expectedCamOps} operator${ticket.expectedCamOps > 1 ? "s" : ""} expected`
          : ticket.onlyOneCamOp
          ? "Only one operator required"
          : "Multiple operators expected"}
      </div>
      <div>
        <span className="font-bold">Assigned Cam Ops:</span>{" "}
        {Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.length > 0
          ? ticket.assignedCamOps.join(", ")
          : "-"}
      </div>

      {/* Journalist / Producer */}
      <div>
        <span className="font-bold">Journalist / Producer:</span>{" "}
        {Array.isArray(ticket.assignedReporter) && ticket.assignedReporter.length > 0
          ? ticket.assignedReporter.join(", ")
          : typeof ticket.assignedReporter === "string" && ticket.assignedReporter.trim()
          ? ticket.assignedReporter
          : "-"}
      </div>

      {ticket.type === "News" && ticket.category && (
        <div>
          <span className="font-bold">News Category:</span> {ticket.category}
        </div>
      )}
      {ticket.type === "Sports" && ticket.subtype && (
        <div>
          <span className="font-bold">Sports Subtype:</span> {ticket.subtype}
        </div>
      )}
    </>
  )}

  {/* Full drivers section (expanded view) */}
  <div className="mt-3">
    <div className="font-bold">Drivers</div>
    <div className="mt-1 space-y-1">
      <div>
        <span className="font-bold">To (main):</span>{" "}
        <span className="font-medium">{ticket.assignedDriver || "-"}</span>
      </div>
      <div>
        <span className="font-bold">From (return):</span>{" "}
        <span className="font-medium">{ticket.assignedDriverFrom || "-"}</span>
      </div>
      <div>
        <span className="font-bold">Additional:</span>{" "}
        <span className="font-medium">
          {Array.isArray(ticket.additionalDrivers) && ticket.additionalDrivers.length > 0
            ? ticket.additionalDrivers.filter(Boolean).join(", ")
            : "-"}
        </span>
      </div>
    </div>
  </div>
</div>

<div className="mt-3">
  <span className="font-bold">Assigned By:</span>{" "}
  <span className="text-gray-700 font-medium">
    {ticket.assignedBy || "Unknown"}
  </span>
</div>

<div className="mt-2">
  <div className="font-bold">Notes</div>
  {Array.isArray(ticket.notes) && ticket.notes.length > 0 ? (
    <ul className="list-disc list-inside ml-2 mt-1">
      {ticket.notes.map((note, noteIdx) => (
        <li key={noteIdx}>
          {note.text}{" "}
          <span className="text-gray-500 text-xs">
            — {note.author}, {note.timestamp}
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-gray-500 italic">No notes</p>
  )}
</div>

      {canAddNotes && (
        <div className="mt-2">
          <input
            type="text"
            placeholder="Add note"
            value={newNotes[ticket.id] || ""}
            onChange={(e) =>
              setNewNotes((prev) => ({
                ...prev,
                [ticket.id]: e.target.value,
              }))
            }
            className="border rounded p-1 w-2/3 mr-2"
          />
          <button
            onClick={() => handleAddNote(ticket.id)}
            className="text-xs text-blue-600 hover:underline"
          >
            Add Note
          </button>
        </div>
      )}
    </td>
  </tr>
)}

                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

{/* Technical Work (only visible when there are active Technical tickets) */}
{technicalCurrent.length > 0 && (
  <div className="mt-6">
    <h2 className="text-lg font-semibold mb-2">Technical Work</h2>

    {/* Controls for Technical table */}
    <div className="flex flex-wrap items-center mb-2 gap-2">
      <button
        onClick={() => {
          setSelectedTechIds([]);
          setTechExpandedIds([]);
          setTechExpandAll(false);
        }}
        className="px-3 py-1 border rounded"
        title="Reset selection & expansion"
      >
        Reset
      </button>

      <button
        onClick={() => {
          if (selectedTechIds.length === technicalCurrent.length) {
            setSelectedTechIds([]);
          } else {
            setSelectedTechIds(technicalCurrent.map((t) => t.id));
          }
        }}
        className="px-3 py-1 border rounded"
      >
        {selectedTechIds.length === technicalCurrent.length
          ? "Deselect All"
          : "Select All"}
      </button>

      <button
        onClick={() => {
          if (techExpandAll) {
            setTechExpandedIds([]);
            setTechExpandAll(false);
          } else {
            setTechExpandedIds(technicalCurrent.map((t) => t.id));
            setTechExpandAll(true);
          }
        }}
        className="px-3 py-1 border rounded"
      >
        {techExpandAll ? "Collapse All" : "Expand All"}
      </button>

      <input
        type="text"
        value={techSearch}
        onChange={(e) => setTechSearch(e.target.value)}
        placeholder="Search (title, location, scope, technicians)…"
        className="ml-auto border rounded px-2 py-1 text-sm w-72"
      />
    </div>

    {/* Bulk actions for Technical */}
    {selectedTechIds.length > 0 && (
      <div className="flex gap-2 mb-2">
        <button
          onClick={async () => {
            try {
              const toArchive = technicalCurrent.filter((t) =>
                selectedTechIds.includes(t.id)
              );
              for (const ticket of toArchive) {
                await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ archived: true }),
                });
              }
              const res = await fetch(`${API_BASE}/tickets`);
              const updated = await res.json();
              setTickets(updated);
              setSelectedTechIds([]);
              setTechExpandedIds([]);
              setTechExpandAll(false);
            } catch (err) {
              console.error("Failed to archive Technical tickets:", err);
            }
          }}
          className="text-yellow-600 border border-yellow-600 hover:bg-yellow-100 px-3 py-1 rounded-md transition"
        >
          Send to Archives
        </button>

        <button
          onClick={async () => {
            try {
              const toRecycle = technicalCurrent.filter((t) =>
                selectedTechIds.includes(t.id)
              );
              for (const ticket of toRecycle) {
                await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ deleted: true }),
                });
              }
              const res = await fetch(`${API_BASE}/tickets`);
              const updated = await res.json();
              setTickets(updated);
              setSelectedTechIds([]);
              setTechExpandedIds([]);
              setTechExpandAll(false);
            } catch (err) {
              console.error("Failed to recycle Technical tickets:", err);
            }
          }}
          className="text-red-500 border border-red-500 hover:bg-red-100 px-3 py-1 rounded-md transition"
        >
          Send to Recycle Bin
        </button>
      </div>
    )}

    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border border-gray-300 table-fixed">
        <thead className="bg-slate-800 text-white">
          <tr>
            <th className="px-2 py-1 text-center text-xs font-semibold">Select</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Title</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Scope of Work</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Technicians</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Departure Time</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Location</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Status</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {technicalCurrent
            .filter((t) => {
              const q = techSearch.trim().toLowerCase();
              if (!q) return true;
              const text = [
                t.title,
                t.location,
                t.scopeOfWork,
                ...(Array.isArray(t.assignedTechnicians) ? t.assignedTechnicians : []),
              ]
                .join(" ")
                .toLowerCase();
              return text.includes(q);
            })
            .sort((a, b) => {
              const aIso = String(a?.date || "");
              const bIso = String(b?.date || "");
              return aIso.localeCompare(bIso);
            })
            .map((ticket, idx) => {
              const isExpanded = techExpandedIds.includes(ticket.id);
              const isEditing = editingId === ticket.id;

              const techArray =
                Array.isArray(isEditing ? editData?.assignedTechnicians : ticket.assignedTechnicians)
                  ? (isEditing ? editData.assignedTechnicians : ticket.assignedTechnicians)
                  : [];

              const technicians =
                techArray.length > 0 ? techArray.join(", ") : "-";

              // Compute default “Assigned” if technicians present
              const hasTeam = techArray.length > 0;
              const computedDefault = hasTeam ? "Assigned" : "Unassigned";
              const effectiveStatus = (isEditing ? editData?.assignmentStatus : ticket.assignmentStatus) || computedDefault;

              return (
                <React.Fragment key={ticket.id}>
                  <tr className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} border-b`}>
                    {/* Select */}
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedTechIds.includes(ticket.id)}
                        onChange={() =>
                          setSelectedTechIds((prev) =>
                            prev.includes(ticket.id)
                              ? prev.filter((x) => x !== ticket.id)
                              : [...prev, ticket.id]
                          )
                        }
                      />
                    </td>

                    {/* Title */}
                    <td className="px-2 py-1 text-center align-middle">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData?.title ?? ticket.title ?? ""}
                          onChange={(e) =>
                            setEditData((d) => ({ ...(d || {}), title: e.target.value }))
                          }
                          className="border px-2 py-1 rounded w-full"
                        />
                      ) : (
                        <div className="truncate max-w-[160px] mx-auto">
                          {ticket.title || "-"}
                        </div>
                      )}
                    </td>

                    {/* Scope of Work */}
                    <td className="px-2 py-1 text-center align-middle">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData?.scopeOfWork ?? ticket.scopeOfWork ?? ""}
                          onChange={(e) =>
                            setEditData((d) => ({ ...(d || {}), scopeOfWork: e.target.value }))
                          }
                          className="border px-2 py-1 rounded w-full"
                        />
                      ) : (
                        ticket.scopeOfWork || "-"
                      )}
                    </td>

                    {/* Technicians (comma-separated) */}
                    <td className="px-2 py-1 text-center align-middle">
                      {isEditing ? (
                        <input
                          type="text"
                          value={
                            Array.isArray(editData?.assignedTechnicians)
                              ? editData.assignedTechnicians.join(", ")
                              : ""
                          }
                          onChange={(e) => {
                            const list = e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean);
                            setEditData((d) => ({ ...(d || {}), assignedTechnicians: list }));
                          }}
                          placeholder="e.g. Alice, Bob"
                          className="border px-2 py-1 rounded w-full"
                        />
                      ) : (
                        <div className="truncate max-w-[180px] mx-auto" title={technicians}>
                          {technicians}
                        </div>
                      )}
                    </td>

                    {/* Departure Time */}
                    <td className="px-2 py-1 text-center align-middle">
                      {isEditing ? (
                        <input
                          type="time"
                          step="300"
                          value={editData?.departureTime ?? (ticket.departureTime || "")}
                          onChange={(e) =>
                            setEditData((d) => ({ ...(d || {}), departureTime: e.target.value }))
                          }
                          className="border px-2 py-1 rounded"
                        />
                      ) : (
                        ticket.departureTime || "-"
                      )}
                    </td>

                    {/* Location */}
                    <td className="px-2 py-1 text-center align-middle">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData?.location ?? ticket.location ?? ""}
                          onChange={(e) =>
                            setEditData((d) => ({ ...(d || {}), location: e.target.value }))
                          }
                          className="border px-2 py-1 rounded w-full"
                        />
                      ) : (
                        <div className="truncate max-w-[140px] mx-auto">
                          {ticket.location || "-"}
                        </div>
                      )}
                    </td>

                    {/* Status — same Popover UX as first table */}
                    <td className="p-2 text-center whitespace-nowrap">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button type="button">
                            <Badge
                              variant={
                                effectiveStatus === "Completed"
                                  ? "success"
                                  : effectiveStatus === "In Progress"
                                  ? "secondary"
                                  : effectiveStatus === "Cancelled"
                                  ? "destructive"
                                  : effectiveStatus === "Postponed"
                                  ? "outline"
                                  : hasTeam
                                  ? "default"
                                  : "outline"
                              }
                              className="text-xs cursor-pointer"
                            >
                              {effectiveStatus}
                            </Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[180px] p-2">
                          <div className="space-y-1">
                            {["Unassigned","Assigned","In Progress","Completed","Postponed","Cancelled"].map((status) => (
                              <div
                                key={status}
                                onClick={() => {
                                  if (isEditing) {
                                    setEditData((d) => ({ ...(d || {}), assignmentStatus: status }));
                                  } else {
                                    handleStatusChange(ticket.id, status);
                                  }
                                }}
                                className="cursor-pointer px-2 py-1 hover:bg-accent rounded text-sm"
                              >
                                {status}
                              </div>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </td>

                    {/* Actions */}
                    <td className="p-2 text-center whitespace-nowrap">
                      <div className="flex gap-2 justify-center">
                        {isEditing ? (
                          <>
                            <button
                              className="text-green-600 hover:underline text-xs"
                              onClick={saveEditing}
                            >
                              Save
                            </button>
                            <button
                              className="text-gray-600 hover:underline text-xs"
                              onClick={cancelEditing}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="text-blue-600 hover:underline text-xs"
                              onClick={() => startEditing(ticket.id)}
                            >
                              Edit
                            </button>
                            <button
                              className="text-yellow-600 hover:underline text-xs"
                              onClick={() =>
                                setTechExpandedIds((prev) =>
                                  prev.includes(ticket.id)
                                    ? prev.filter((x) => x !== ticket.id)
                                    : [...prev, ticket.id]
                                )
                              }
                            >
                              {isExpanded ? "Collapse" : "Expand"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Row (Technical) */}
                  {isExpanded && (
                    <tr className="bg-gray-100">
                      <td colSpan={8} className="p-4 text-sm text-gray-700">
                        {/* FULL TITLE */}
                        <div className="mb-3">
                          <strong className="block text-gray-600">Title</strong>
                          <div className="text-base font-semibold leading-snug break-words">
                            {(isEditing ? editData?.title : ticket.title) || "-"}
                          </div>
                        </div>

                        {/* Keep Location visible here too */}
                        <div className="mb-2 space-y-1">
                          <div>
                            <strong>Scope of Work:</strong>{" "}
                            {(isEditing ? editData?.scopeOfWork : ticket.scopeOfWork) || "-"}
                          </div>
                          <div>
                            <strong>Assigned Technicians:</strong>{" "}
                            {techArray.length > 0 ? techArray.join(", ") : "-"}
                          </div>
                          <div>
                            <strong>Departure Time:</strong>{" "}
                            {(isEditing ? editData?.departureTime : ticket.departureTime) || "-"}
                          </div>
                          <div>
                            <strong>Location:</strong>{" "}
                            {(isEditing ? editData?.location : ticket.location) || "-"}
                          </div>
                          <div>
                            <strong>Status:</strong>{" "}
                            {effectiveStatus}
                          </div>
                        </div>

                        <div className="mt-3">
                          <strong>Assigned By:</strong>{" "}
                          <span className="text-gray-700 font-medium">
                            {ticket.assignedBy || "Unknown"}
                          </span>
                        </div>

                        <div className="mt-2">
                          <strong>Notes:</strong>
                          {Array.isArray(ticket.notes) && ticket.notes.length > 0 ? (
                            <ul className="list-disc list-inside ml-2 mt-1">
                              {ticket.notes.map((note, noteIdx) => (
                                <li key={noteIdx}>
                                  {note.text}{" "}
                                  <span className="text-gray-500 text-xs">
                                    — {note.author}, {note.timestamp}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-gray-500 italic">No notes</p>
                          )}
                        </div>

                        {canAddNotes && (
                          <div className="mt-2">
                            <input
                              type="text"
                              placeholder="Add note"
                              value={newNotes[ticket.id] || ""}
                              onChange={(e) =>
                                setNewNotes((prev) => ({
                                  ...prev,
                                  [ticket.id]: e.target.value,
                                }))
                              }
                              className="border rounded p-1 w-2/3 mr-2"
                            />
                            <button
                              onClick={() => handleAddNote(ticket.id)}
                              className="text-xs text-blue-600 hover:underline"
                            >
                              Add Note
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  </div>
)}


      {/* Archived Tickets */}
<div className="mt-6">
  <button
    onClick={() => setShowArchived(!showArchived)}
    className="flex items-center gap-1 text-sm underline"
  >
    {showArchived ? (
      <>
        <ChevronUp size={16} /> Hide Archived (
        {tickets.filter((t) => t.archived).length})
      </>
    ) : (
      <>
        <ChevronDown size={16} /> Show Archived (
        {tickets.filter((t) => t.archived).length})
      </>
    )}
  </button>

  {showArchived && (
    <div className="mt-3 border rounded shadow p-2">
      {tickets.filter((t) => t.archived).length === 0 ? (
        <p className="text-gray-500 px-2 py-2">No archived forms.</p>
      ) : (
        <>
          {/* Controls row: Select all, Search, Status filter, Bulk actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2">
            <div className="flex items-center gap-3">
  <button
    className="text-sm text-blue-600 underline"
    onClick={() => {
      const archived = tickets.filter((t) => t.archived);
      if (selectedArchivedIds.length === archived.length) {
        setSelectedArchivedIds([]);
      } else {
        setSelectedArchivedIds(archived.map((t) => t.id));
      }
    }}
  >
    {selectedArchivedIds.length === tickets.filter((t) => t.archived).length
      ? "Deselect All"
      : "Select All in Archives"}
  </button>

  {/* Search */}
  <input
    type="text"
    value={archSearch}
    onChange={(e) => setArchSearch(e.target.value)}
    placeholder="Search (title, location, driver, reporter, cam ops)…"
    className="border rounded px-2 py-1 text-sm w-64"
  />

  {/* Status filter */}
  <select
    value={archStatus}
    onChange={(e) => setArchStatus(e.target.value)}
    className="border rounded px-2 py-1 text-sm"
    title="Filter by status"
  >
    {["all","Unassigned","Assigned","In Progress","Completed","Postponed","Cancelled"].map(s => (
      <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>
    ))}
  </select>

  {/* Type filter */}
  <select
    value={archType}
    onChange={(e) => setArchType(e.target.value)}
    className="border rounded px-2 py-1 text-sm"
    title="Filter by type"
  >
    <option value="all">All types</option>
    <option value="filming">Filming only</option>
    <option value="technical">Technical only</option>
  </select>

  {/* Date filter */}
  <select
    value={archDateFilter}
    onChange={(e) => setArchDateFilter(e.target.value)}
    className="border rounded px-2 py-1 text-sm"
    title="Filter by date"
  >
    <option value="all">All dates</option>
    <option value="today">Today</option>
    <option value="week">This week</option>
    <option value="last_month">Last month</option>
    <option value="day">Specific day…</option>
  </select>

  {/* Specific day picker */}
  {archDateFilter === "day" && (
    <input
      type="date"
      value={archSpecificDay}
      onChange={(e) => setArchSpecificDay(e.target.value)}
      className="border rounded px-2 py-1 text-sm"
      title="Pick a day"
    />
  )}
</div>

            {/* Bulk actions */}
            {selectedArchivedIds.length > 0 && (
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      const toRestore = tickets.filter(
                        (t) => t.archived && selectedArchivedIds.includes(t.id)
                      );
                      for (const ticket of toRestore) {
                        await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ archived: false }),
                        });
                      }
                      setSelectedArchivedIds([]);
                      const response = await fetch(`${API_BASE}/tickets`);
                      const data = await response.json();
                      setTickets(data);
                    } catch (err) {
                      console.error("Failed to restore archived tickets:", err);
                    }
                  }}
                  className="px-3 py-1 border rounded text-green-600 border-green-600 hover:bg-green-50"
                >
                  Restore Selected
                </button>

                <button
                  onClick={async () => {
                    try {
                      const toRecycle = tickets.filter(
                        (t) => t.archived && selectedArchivedIds.includes(t.id)
                      );
                      for (const ticket of toRecycle) {
                        await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ archived: false, deleted: true }),
                        });
                      }
                      setSelectedArchivedIds([]);
                      const response = await fetch(`${API_BASE}/tickets`);
                      const data = await response.json();
                      setTickets(data);
                    } catch (err) {
                      console.error("Failed to move archived tickets to recycle bin:", err);
                    }
                  }}
                  className="px-3 py-1 border rounded text-red-600 border-red-600 hover:bg-red-100"
                >
                  Send to Recycle Bin
                </button>
              </div>
            )}
          </div>

          {/* Derived archived list with search + filter */}
          {(() => {
  const q = archSearch.trim().toLowerCase();

    const matchesQuery = (t) => {
    if (!q) return true;
    const check = (val) => String(val || "").toLowerCase().includes(q);

    return (
      check(t.title) ||
      check(t.location) ||
      check(t.assignedDriver) ||
      check(t.assignedDriverFrom) ||
      check(t.scopeOfWork) || // Technical field
      (Array.isArray(t.assignedTechnicians) && t.assignedTechnicians.some(check)) || // Technical field
      (Array.isArray(t.additionalDrivers) && t.additionalDrivers.some(check)) ||
      (Array.isArray(t.assignedReporter) && t.assignedReporter.some(check)) ||
      (Array.isArray(t.assignedCamOps) && t.assignedCamOps.some(check))
    );
  };

  const isStatusMatch = (t) => {
    const filter = String(archStatus || "all").toLowerCase();
    if (filter === "all") return true;
    const current = String(t.assignmentStatus || "Unassigned").toLowerCase();
    return current === filter;
  };

  const isTypeMatch = (t) => {
    const filter = String(archType || "all").toLowerCase();
    if (filter === "all") return true;
    if (filter === "technical") return t.type === "Technical";
    if (filter === "filming") return t.type !== "Technical";
    return true;
  };

  // Date helpers (local time)
  const parseLocal = (iso) => {
    if (!iso) return null;
    const d = new Date(String(iso));
    return isNaN(d.getTime()) ? null : d;
  };
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const startOfWeekMon = (d) => {
    const x = new Date(d);
    const day = x.getDay(); // 0=Sun
    const diff = day === 0 ? -6 : 1 - day; // Monday start
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() + diff);
    return x;
  };
  const endOfWeekSun = (d) => {
    const s = startOfWeekMon(d);
    const e = new Date(s);
    e.setDate(s.getDate() + 6);
    e.setHours(23, 59, 59, 999);
    return e;
  };

  const startOfToday = () => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  };
  const endOfToday = () => {
    const t = new Date();
    t.setHours(23, 59, 59, 999);
    return t;
  };

  const startOfLastMonth = () => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    return s;
  };
  const endOfLastMonth = () => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); // day 0 = last day prev month
    return s;
  };

  const isDateMatch = (t) => {
    const mode = String(archDateFilter || "all").toLowerCase();
    if (mode === "all") return true;

    const d = parseLocal(t?.date);
    if (!d) return false; // no date → exclude when filtering by time

    if (mode === "today") {
      return d >= startOfToday() && d <= endOfToday();
    }
    if (mode === "week") {
      const s = startOfWeekMon(new Date());
      const e = endOfWeekSun(new Date());
      return d >= s && d <= e;
    }
    if (mode === "last_month") {
      const s = startOfLastMonth();
      const e = endOfLastMonth();
      return d >= s && d <= e;
    }
    if (mode === "day") {
      if (!archSpecificDay) return true; // if no day picked yet, don't hide everything
      const picked = parseLocal(archSpecificDay + "T00:00");
      if (!picked) return false;
      return sameDay(d, picked);
    }
    return true;
  };

  // Filter then sort by date using archSortAsc
  const archivedFiltered = tickets
    .filter((t) => t.archived && matchesQuery(t) && isStatusMatch(t) && isTypeMatch(t) && isDateMatch(t))
    .sort((a, b) => {
      const da = parseLocal(a?.date);
      const db = parseLocal(b?.date);
      const ta = da ? da.getTime() : (archSortAsc ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      const tb = db ? db.getTime() : (archSortAsc ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      return archSortAsc ? ta - tb : tb - ta;
    });

  if (archivedFiltered.length === 0) {
    return (
      <p className="text-gray-500 px-2 py-2">
        No archived forms match your search/filter.
      </p>
    );
  }

  // Same columns as the main table, compact / table-fixed
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border border-gray-300 table-fixed">
        <thead className="bg-blue-800 text-white">
          <tr>
            <th className="px-2 py-1 text-center text-xs font-semibold">Select</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Title</th>
            <th
  className="px-2 py-1 text-center text-xs font-semibold select-none cursor-pointer"
  onClick={() => setArchSortAsc((v) => !v)}
  title="Sort by Filming Date & Time"
>
  <div className="inline-flex items-center justify-center gap-2">
    <span>Filming Date &amp; Time</span>
    <span aria-hidden="true">{archSortAsc ? "▲" : "▼"}</span>
  </div>
</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Departure Time</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Location</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Cam Ops</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Driver</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Assigned Reporter</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Status</th>
            <th className="px-2 py-1 text-center text-xs font-semibold">Actions</th>
          </tr>
        </thead>

        <tbody>
          {archivedFiltered.map((ticket, rowIdx) => {
            const isExpanded = archExpandedIds.includes(ticket.id);

             // date formatting identical to current table
            const filmingISO = ticket.date?.trim?.();
            let filmingDisplay = "-";
            let filmingIsPH = false;

                       if (filmingISO) {
              filmingIsPH = isPublicHoliday(filmingISO);

              const label = formatDDMMYYYY_HHMM(filmingISO);
              if (label) {
                filmingDisplay = label;
              } else {
                filmingDisplay = filmingISO;
              }
            }

            // compact driver summary (same logic you use in current table)
            const main = ticket.assignedDriver || "";
            const ret = ticket.assignedDriverFrom || "";
            const extras = Array.isArray(ticket.additionalDrivers)
              ? ticket.additionalDrivers.filter(Boolean)
              : [];
            const parts = [];
            if (main) parts.push(main);
            if (ret && ret !== main) parts.push(`Return: ${ret}`);
            const extraCount = extras.filter((n) => n && n !== main && n !== ret).length;
            if (extraCount > 0) parts.push(`+${extraCount}`);
            const compactDriver = parts.length ? parts.join(" • ") : "-";
            const driverTitle = [
              main && `To: ${main}`,
              ret && ret !== main && `From: ${ret}`,
              ...extras.filter(Boolean).map((n, i) => `Additional ${i + 1}: ${n}`),
            ]
              .filter(Boolean)
              .join(" | ");

            return (
              <React.Fragment key={ticket.id}>
                <tr
  className={`${rowIdx % 2 === 0 ? "bg-white" : "bg-gray-50"} border-b ${
    ticket.type === "Technical" ? "bg-slate-50" : ""
  }`}
>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={selectedArchivedIds.includes(ticket.id)}
                      onChange={() =>
                        setSelectedArchivedIds((prev) =>
                          prev.includes(ticket.id)
                            ? prev.filter((x) => x !== ticket.id)
                            : [...prev, ticket.id]
                        )
                      }
                    />
                  </td>

                  {/* Title (truncate like current table) */}
                  <td className="px-2 py-1 text-center align-middle">
                    <div className="flex items-center justify-center gap-2">
                      <div className="truncate max-w-[160px]">{ticket.title}</div>
                      {(ticket.camCount > 1 || ticket.expectedCamOps > 1) && (
                        <Badge variant="secondary" className="text-[10px]">
                          👤{ticket.expectedCamOps || 1}🎥{ticket.camCount || 1}
                        </Badge>
                      )}
                    </div>
                  </td>

                  {/* Filming Date & Time */}
                  <td className="px-2 py-1 text-center align-middle">
                    <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
                      <span>{filmingDisplay}</span>
                      {filmingIsPH ? (
                        <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                          (PH)
                        </Badge>
                      ) : null}
                    </div>
                  </td>

                  {/* Departure Time */}
                  <td className="px-2 py-1 text-center align-middle">
                    {ticket.departureTime || "-"}
                  </td>

                  {/* Location */}
                  <td className="px-2 py-1 text-center align-middle">
                    <div className="truncate max-w-[140px] mx-auto">
                      {ticket.location || "-"}
                    </div>
                  </td>

                  {/* Cam Ops */}
                  <td className="px-2 py-1 text-center align-middle">
                    {Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.length > 0
                      ? ticket.assignedCamOps.join(", ")
                      : "-"}
                  </td>

                  {/* Driver */}
                  <td className="px-2 py-1 text-center align-middle">
                    <div className="truncate max-w-[160px] mx-auto" title={driverTitle}>
                      {compactDriver}
                    </div>
                  </td>

                  {/* Assigned Reporter */}
                  <td className="px-2 py-1 text-center align-middle">
                    {Array.isArray(ticket.assignedReporter) && ticket.assignedReporter.length > 0 ? (
                      <div className="truncate max-w-[160px] mx-auto">
                        {ticket.assignedReporter.join(", ")}
                      </div>
                    ) : typeof ticket.assignedReporter === "string" &&
                      ticket.assignedReporter.trim() ? (
                      <div className="truncate max-w-[160px] mx-auto">
                        {ticket.assignedReporter}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-2 py-1 text-center align-middle">
                    <StatusBadge status={ticket.assignmentStatus || "Unassigned"} />
                  </td>

                  {/* Actions (Expand only for archives) */}
                  <td className="px-2 py-1 text-center align-middle">
                    <button
                      className="text-blue-600 hover:underline text-xs"
                      onClick={() =>
                        setArchExpandedIds((prev) =>
                          prev.includes(ticket.id)
                            ? prev.filter((x) => x !== ticket.id)
                            : [...prev, ticket.id]
                        )
                      }
                    >
                      {isExpanded ? "Collapse" : "Expand"}
                    </button>
                  </td>
                </tr>

                {/* Expanded Row (archives) */}
                {isExpanded && (
                  <tr className="bg-gray-100">
                    <td colSpan={10} className="p-4 text-sm text-gray-700">
                      {/* FULL TITLE */}
                      <div className="mb-3">
                        <strong className="block text-gray-600">Title</strong>
                        <div className="text-base font-semibold leading-snug break-words">
                          {ticket.title || "-"}
                        </div>
                      </div>

                                         <div className="mb-2 space-y-1">
                        {ticket.type === "Technical" ? (
                          <>
                            <div>
                              <strong>Scope of Work:</strong>{" "}
                              {ticket.scopeOfWork || "-"}
                            </div>
                            <div>
                              <strong>Assigned Technicians:</strong>{" "}
                              {Array.isArray(ticket.assignedTechnicians) && ticket.assignedTechnicians.length > 0
                                ? ticket.assignedTechnicians.join(", ")
                                : "-"}
                            </div>
                            <div>
                              <strong>Departure Time:</strong>{" "}
                              {ticket.departureTime || "-"}
                            </div>
                            <div>
                              <strong>Location:</strong>{" "}
                              {ticket.location || "-"}
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <strong>Number of Cameras:</strong>{" "}
                              {ticket.camCount}
                            </div>
                            <div>
                              <strong>Cam Op Requirement:</strong>{" "}
                              {ticket.expectedCamOps
                                ? `${ticket.expectedCamOps} operator${ticket.expectedCamOps > 1 ? "s" : ""} expected`
                                : ticket.onlyOneCamOp
                                ? "Only one operator required"
                                : "Multiple operators expected"}
                            </div>
                            <div>
                              <strong>Assigned Cam Ops:</strong>{" "}
                              {Array.isArray(ticket.assignedCamOps) && ticket.assignedCamOps.length > 0
                                ? ticket.assignedCamOps.join(", ")
                                : "-"}
                            </div>
                            {ticket.type === "News" && ticket.category && (
                              <div>
                                <strong>News Category:</strong> {ticket.category}
                              </div>
                            )}
                            {ticket.type === "Sports" && ticket.subtype && (
                              <div>
                                <strong>Sports Subtype:</strong> {ticket.subtype}
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Drivers detail */}
                      <div className="mt-3">
                        <strong>Drivers:</strong>
                        <div className="mt-1 space-y-1">
                          <div>
                            <span className="text-gray-600">To (main):</span>{" "}
                            <span className="font-medium">{ticket.assignedDriver || "-"}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">From (return):</span>{" "}
                            <span className="font-medium">{ticket.assignedDriverFrom || "-"}</span>
                          </div>
                          <div>
                            <span className="text-gray-600">Additional:</span>{" "}
                            <span className="font-medium">
                              {Array.isArray(ticket.additionalDrivers) && ticket.additionalDrivers.length > 0
                                ? ticket.additionalDrivers.filter(Boolean).join(", ")
                                : "-"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3">
                        <strong>Assigned By:</strong>{" "}
                        <span className="text-gray-700 font-medium">
                          {ticket.assignedBy || "Unknown"}
                        </span>
                      </div>

                      <div className="mt-2">
                        <strong>Notes:</strong>
                        {Array.isArray(ticket.notes) && ticket.notes.length > 0 ? (
                          <ul className="list-disc list-inside ml-2 mt-1">
                            {ticket.notes.map((note, noteIdx) => (
                              <li key={noteIdx}>
                                {note.text}{" "}
                                <span className="text-gray-500 text-xs">
                                  — {note.author}, {note.timestamp}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-gray-500 italic">No notes</p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
})()}
        </>
      )}
    </div>
  )}
</div>


      {/* Recycle Bin */}
      <div className="mt-6">
        <button
          onClick={() => setShowDeleted(!showDeleted)}
          className="flex items-center gap-1 text-sm underline"
        >
          {showDeleted ? (
            <>
              <ChevronUp size={16} /> Hide Recycle Bin (
              {tickets.filter((t) => t.deleted).length})
            </>
          ) : (
            <>
              <ChevronDown size={16} /> Show Recycle Bin (
              {tickets.filter((t) => t.deleted).length})
            </>
          )}
        </button>

        {showDeleted && (
          <div className="mt-3 border rounded shadow">
            <div className="flex items-center justify-between p-2">
              <button
                className="text-sm text-blue-600 underline"
                onClick={() => {
                  const deleted = tickets.filter((t) => t.deleted);
                  if (selectedDeletedIds.length === deleted.length) {
                    setSelectedDeletedIds([]);
                  } else {
                    setSelectedDeletedIds(deleted.map((t) => t.id));
                  }
                }}
              >
                {selectedDeletedIds.length ===
                tickets.filter((t) => t.deleted).length
                  ? "Deselect All"
                  : "Select All in Recycle Bin"}
              </button>

              {selectedDeletedIds.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowRestoreModal(true)}
                    className="px-3 py-1 border rounded text-green-600 border-green-600 hover:bg-green-50"
                  >
                    Restore Selected
                  </button>
                  <button
                    onClick={() => setShowPermanentDeleteModal(true)}
                    className="px-3 py-1 border rounded text-red-600 border-red-600 hover:bg-red-100"
                  >
                    Permanently Delete
                  </button>
                </div>
              )}
            </div>

            {tickets.filter((t) => t.deleted).length === 0 ? (
              <p className="text-gray-500 px-2 py-2">No deleted forms.</p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-gray-200">
                  <tr>
                    <th className="p-2 text-center">Select</th>
                    <th className="p-2 text-center">Title</th>
                    <th className="p-2 text-center">Filming</th>
                    <th className="p-2 text-center">Departure</th>
                    <th className="p-2 text-center">Location</th>
                    <th className="p-2 text-center">Driver</th>
                    <th className="p-2 text-center">Status</th>
                    <th className="p-2 text-center">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets
                    .filter((t) => t.deleted)
                    .map((ticket, idx) => {
                      const isSelected =
                        selectedDeletedIds.includes(ticket.id);
                                         const date = ticket.date?.trim?.();
                      const formatted = date ? formatDDMMYYYY_HHMM(date) : "";
                      const safeFormatted = formatted || "-";

                      const isPH = isPublicHoliday(ticket?.date);

                      return (
                        <tr
                          key={ticket.id}

                          className={
                            idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                          }
                        >
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedDeletedIds((prev) =>
                                  prev.includes(ticket.id)
                                    ? prev.filter((x) => x !== ticket.id)
                                    : [...prev, ticket.id]
                                );
                              }}
                            />
                          </td>
                        <td className="p-2 text-center">{ticket.title}</td>
                          <td className="p-2 text-center">
                            <div className="inline-flex items-center justify-center gap-2 whitespace-nowrap">
                              <span>{formatted}</span>
                              {isPH ? (
                                <Badge variant="outline" className="text-[10px] px-2 py-0.5">
                                  (PH)
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-2 text-center">
                            {ticket.departureTime || "-"}
                          </td>
                          <td className="p-2 text-center">
                            {ticket.location || "-"}
                          </td>
                          <td className="p-2 text-center">
                            {ticket.assignedDriver || "-"}
                          </td>
                          <td className="p-2 text-center">
                            <StatusBadge
                              status={ticket.assignmentStatus || "Unassigned"}
                            />
                          </td>
                          <td className="p-2 text-center">
                            {ticket.priority || "Normal"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Recycle Modal */}
      <AlertDialog open={showRecycleModal} onOpenChange={setShowRecycleModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send selected forms to Recycle Bin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              These forms will be moved to the Recycle Bin. You can restore them
              later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async () => {
                try {
                  const toDelete = tickets.filter(
                    (t) =>
                      !t.deleted &&
                      !t.archived &&
                      selectedCurrentIds.includes(t.id)
                  );

                  for (const ticket of toDelete) {
                    await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ deleted: true }),
                    });
                  }

                  const res = await fetch(`${API_BASE}/tickets`);
                  const updated = await res.json();
                  setTickets(updated);
                  setSelectedCurrentIds([]);
                  setShowRecycleModal(false);
                } catch (err) {
                  console.error("Failed to recycle tickets:", err);
                }
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Modal */}
      <AlertDialog open={showRestoreModal} onOpenChange={setShowRestoreModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore selected forms?</AlertDialogTitle>
            <AlertDialogDescription>
              These forms will be restored to the main list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={async () => {
                try {
                  const toRestore = tickets.filter(
                    (t) => t.deleted && selectedDeletedIds.includes(t.id)
                  );

                  for (const ticket of toRestore) {
                    await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ deleted: false }),
                    });
                  }

                  setSelectedDeletedIds([]);
                  setShowRestoreModal(false);

                  const response = await fetch(`${API_BASE}/tickets`);
                  const data = await response.json();
                  setTickets(data);
                } catch (err) {
                  console.error("Failed to restore tickets:", err);
                }
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanently Delete Modal */}
      <AlertDialog
        open={showPermanentDeleteModal}
        onOpenChange={setShowPermanentDeleteModal}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Permanently delete selected forms?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-red-600 font-semibold">
              This action cannot be undone. The selected forms will be deleted
              forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async () => {
                try {
                  const toDelete = tickets.filter(
                    (t) => t.deleted && selectedDeletedIds.includes(t.id)
                  );

                  for (const ticket of toDelete) {
                    await fetch(`${API_BASE}/tickets/${ticket.id}`, {
                      method: "DELETE",
                    });
                  }

                  setSelectedDeletedIds([]);
                  setShowPermanentDeleteModal(false);

                  const response = await fetch(`${API_BASE}/tickets`);
                  const data = await response.json();
                  setTickets(data);
                } catch (err) {
                  console.error("Failed to permanently forms:", err);
                }
              }}
            >
              Delete Forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
