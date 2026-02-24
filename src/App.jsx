import { useState, useEffect, useRef, useCallback } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import API_BASE from "@/api";
import TicketForm from "@/components/TicketForm";
import AdminPanel from "@/components/AdminPanel";
import TicketFormPage from "@/pages/TicketFormPage";
import OperationsPage from "@/pages/OperationsPage";
import AdminPage from "@/pages/AdminPage";
import LoginPage from "@/pages/LoginPage";
import SetPasswordPage from "@/pages/SetPasswordPage";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import TicketPage from "@/pages/TicketPage";
import HomeCarousel from "@/components/HomeCarousel";
import FleetPage from "@/pages/FleetPage";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import MyProfile from "@/pages/MyProfile";
import ChangelogDialog from "@/components/ChangelogDialog";
import { requestPermission, onMessage } from "@/lib/firebase";
import AdminGlobalToasts from "@/components/AdminGlobalToasts";
import { playSoundFor, installSoundUnlockOnGesture } from "@/lib/soundRouter";

/* ===========================
   🏢 Team hub pages (Newsroom / Sports / Production)
   =========================== */
import NewsroomPage from "@/pages/NewsroomPage";
import SportsPage from "@/pages/SportsPage";
import ProductionPage from "@/pages/ProductionPage";


/* ===========================
   🧩 Notification helpers start here
   - Fixes missing makeNotifKey / recipientsMatchUser crashes
   - Keeps classic toast pipeline stable (poll + local events)
   =========================== */

// Normalize to second precision (stable dedupe keys)
const isoSec = (d) => {
  try {
    return new Date(d).toISOString().split(".")[0];
  } catch {
    return "";
  }
};

// ✅ Notification dedupe key builder
const makeNotifKey = ({ timestamp, title, message, fallbackTs }) => {
  const ts = isoSec(timestamp) || isoSec(fallbackTs) || "";
  const t = String(title || "").trim();
  const m = String(message || "").trim();
  return `${ts}||${t}||${m}`;
};

// ✅ Recipient matcher used by polling (classic behavior)
const recipientsMatchUser = ({
  recipients,
  userName,
  userId,
  userRoles,
  userSection,
}) => {
  try {
    const list = Array.isArray(recipients)
      ? recipients
      : typeof recipients === "string"
      ? recipients
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // If backend sent no recipients, allow (prevents “silent nothing”)
    if (list.length === 0) return true;

    const norm = (s) => String(s || "").trim().toLowerCase();

    const name = norm(userName);
    const id = norm(userId);
    const section = norm(userSection);

    const roles = Array.isArray(userRoles)
      ? userRoles.map(norm).filter(Boolean)
      : [];

    // “Everyone / All” buckets
    const universal = new Set([
      "all",
      "everyone",
      "everybody",
      "broadcast",
      "lo board",
      "loboard",
      "team",
      "staff",
      "users",
    ]);

    // Admin buckets (because you frequently use these)
    const adminBuckets = new Set(["admin", "admins", "administrators"]);

    for (const r of list) {
      const rr = norm(r);
      if (!rr) continue;

      if (universal.has(rr)) return true;

      // direct match (name/id)
      if (name && rr === name) return true;
      if (id && rr === id) return true;

      // section match
      if (section && rr === section) return true;

      // role match
      if (roles.length && roles.includes(rr)) return true;

      // admin bucket match
      if (adminBuckets.has(rr) && roles.includes("admin")) return true;

      // soft match: sometimes recipients contain “Admins” or “Newsroom” etc.
      if (name && rr.includes(name)) return true;
      if (section && rr.includes(section)) return true;
    }

    return false;
  } catch {
    // Fail open so classic toasts don't die
    return true;
  }
};

/* ===========================
   🧩 Notification helpers end here
   =========================== */

function AppWrapper() {
  return (
    <Router>
      <App />
    </Router>
  );
}


function App() {
  const [loggedInUser, setLoggedInUser] = useState(() => {
    const stored = localStorage.getItem("loggedInUser");
    return stored ? JSON.parse(stored) : null;
  });

  // ✅ Admin "View As" (testing / impersonation) — stored in React state so UI/fetch updates instantly
  const [adminViewAs, setAdminViewAs] = useState(() => {
    const stored = localStorage.getItem("adminViewAs");
    return stored ? JSON.parse(stored) : null;
  });

  // ✅ Only admins are allowed to "view as"
  const isAdmin = !!loggedInUser?.roles?.includes("admin");

  // ✅ Single source of truth user for "profile-like" views
  const effectiveUser = isAdmin && adminViewAs ? adminViewAs : loggedInUser;


  const [users, setUsers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [archivedTickets, setArchivedTickets] = useState(() => {
    const stored = localStorage.getItem("archivedTickets");
    return stored ? JSON.parse(stored) : [];
  });
  const [deletedTickets, setDeletedTickets] = useState(() => {
    const stored = localStorage.getItem("deletedTickets");
    return stored ? JSON.parse(stored) : [];
  });

       const location = useLocation();
  const navigate = useNavigate();

  // ✅ Public routes that should be accessible when NOT logged in
  const PUBLIC_PATHS = ["/login", "/set-password", "/forgot", "/reset"];

  const hideLayout = PUBLIC_PATHS.includes(location.pathname);
  const { toast } = useToast();

    /* ===========================
     🟢 Session restore stamp starts here
     - If user session is restored from localStorage (no fresh /auth/login),
       ensure lastOnline moves immediately.
     =========================== */
  useEffect(() => {
    const userId = String(loggedInUser?.id || "").trim();
    if (!userId) return;

    // Fire-and-forget; do not block UI
    fetch(`${API_BASE}/users/${userId}/last-online`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastOnline: new Date().toISOString(), source: "restore" }),
    }).catch(() => {});
  }, [loggedInUser?.id]);
  /* ===========================
     🟢 Session restore stamp ends here
     =========================== */

  /* ===========================
     🔐 Auth redirect starts here
     - If refresh loads as “guest”, force user back to /login
     - Also clears stale adminViewAs so it never “hangs around”
     =========================== */
  useEffect(() => {
    const isPublic = PUBLIC_PATHS.includes(location.pathname);

    if (!loggedInUser) {
      // Clear stale adminViewAs if any (safe)
      try {
        localStorage.removeItem("adminViewAs");
      } catch {
        // ignore
      }
      setAdminViewAs(null);

      if (!isPublic) {
        navigate("/login", { replace: true });
      }
    }
  }, [loggedInUser, location.pathname, navigate]);
  /* ===========================
     🔐 Auth redirect ends here
     =========================== */

    // ✅ Install one global "unlock audio" handler (fixes Chrome autoplay restrictions)
  useEffect(() => {
    // ✅ Install one global "unlock audio" handler (fixes Chrome autoplay restrictions)
    installSoundUnlockOnGesture();


    // ✅ Load users once so Admin/User/Leave views have content
    const loadUsers = async () => {
      try {
        const res = await fetch(`${API_BASE}/users`);
        if (!res.ok) throw new Error(`Failed to load users (${res.status})`);

        const data = await res.json().catch(() => []);
        setUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load users:", err);
        setUsers([]);
      }
    };

    // ✅ Load tickets once so Home + Tickets pages have content
    const loadTickets = async () => {
      try {
        const res = await fetch(`${API_BASE}/tickets`);
        if (!res.ok) throw new Error(`Failed to load tickets (${res.status})`);

        const data = await res.json().catch(() => []);
        setTickets(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load tickets:", err);
        setTickets([]);
      }
    };

    // ✅ Load vehicles once so FleetPage gets real data
    const loadVehicles = async () => {
      try {
        const res = await fetch(`${API_BASE}/vehicles`);
        if (!res.ok) throw new Error(`Failed to load vehicles (${res.status})`);

        const data = await res.json().catch(() => []);
        setVehicles(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load vehicles:", err);
        setVehicles([]);
      }
    };

    /* ===========================
       🗓️ Rosters initial fetch
       =========================== */
    const loadRosters = async () => {
      try {
        // Note: your backend currently returns "Cannot GET /rosters"
        // This will quietly fail until the route exists.
        const res = await fetch(`${API_BASE}/rosters`);
        if (!res.ok) throw new Error(`Failed to load rosters (${res.status})`);

        const data = await res.json().catch(() => null);
        // Only set if your App.jsx actually has setRosters in scope
        if (typeof setRosters === "function") {
          setRosters(data);
        }
      } catch (err) {
        console.warn("Rosters not available yet:", err?.message || err);
      }
    };

    // Fire all initial loads
    loadUsers();
    loadTickets();
    loadVehicles();
    loadRosters();
  }, []);


  /* ===========================
     🔊 Global Toast/Sound starts here
     All app-wide toast + sound triggers are routed ONLY inside this section.
     =========================== */

  // ✅ Ticket-rich toast helper (works for BOTH poll + push, without breaking non-ticket notes)
    const buildTicketToastExtras = (note) => {
    try {
      // Accept multiple shapes (backend can evolve without breaking UI)
      const src =
        note?.ticket ||
        note?.ticketData ||
        note?.ticketInfo ||
        note?.meta?.ticket ||
        note?.data?.ticket ||
        note?.__ticket ||
        note ||
        {};

      const bits = [];

      const pick = (v) =>
        v === null || v === undefined ? "" : String(v).trim();

      const normalize = (s) => pick(s).toLowerCase();

      // ✅ Pull a "title hint" from message
      // - For "Ticket updated": message is only the ticket title (e.g., "hgfghv")
      // - For "New Request Created": message looks like "title • yyyy-mm-dd hh:mm • location"
      const rawMsg = pick(note?.message);
      const titleHint = rawMsg.includes("•")
        ? pick(rawMsg.split("•")[0])
        : rawMsg;

      // --- 1) Direct fields on ticket-ish object ---
      let date = pick(src.date || src.ticketDate);
      let filmingTime = pick(src.filmingTime || src.ticketFilmingTime);
      let departureTime = pick(src.departureTime || src.ticketDepartureTime);
      let location = pick(src.location || src.ticketLocation);
      let vehicle = pick(src.vehicle || src.ticketVehicle);

      let assignedDriver = pick(src.assignedDriver || src.driver || src.ticketDriver);
      let assignedReporter = pick(src.assignedReporter || src.reporter || src.ticketReporter);

      const camOpsRaw = src.assignedCamOps || src.camOps || src.ticketCamOps;
      let camOps = Array.isArray(camOpsRaw)
        ? camOpsRaw.filter(Boolean).join(", ")
        : pick(camOpsRaw);

      let camCount = pick(src.camCount || src.cameras || src.ticketCamCount);

      // --- 2) Try lookup from App state (tickets[]) by ID first, then by title hint ---
      const possibleId =
        pick(src.id || src.ticketId || src._id) ||
        pick(note?.ticketId || note?.data?.ticketId || note?.meta?.ticketId);

      const chooseBestByTime = (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const score = (t) => {
          const a =
            new Date(t?.updatedAt || t?.modifiedAt || t?.createdAt || 0).getTime() ||
            0;
          const b = new Date(t?.date || 0).getTime() || 0;
          return Math.max(a, b);
        };
        return arr.reduce((best, cur) => (score(cur) > score(best) ? cur : best), arr[0]);
      };

      let found = null;

      if (possibleId) {
        found = Array.isArray(tickets)
          ? tickets.find((t) => String(t?.id) === String(possibleId))
          : null;
      }

      if (!found && titleHint) {
        const hint = normalize(titleHint);

        const matches = Array.isArray(tickets)
          ? tickets.filter((t) => normalize(t?.title) === hint)
          : [];

        found = chooseBestByTime(matches);

        // If still not found, try "contains" match (helps if titles include prefixes)
        if (!found && Array.isArray(tickets)) {
          const soft = tickets.filter((t) => normalize(t?.title).includes(hint));
          found = chooseBestByTime(soft);
        }
      }

      // If found, fill missing fields from ticket
      if (found) {
        date = date || pick(found.date);
        filmingTime = filmingTime || pick(found.filmingTime);
        departureTime = departureTime || pick(found.departureTime);
        location = location || pick(found.location);
        vehicle = vehicle || pick(found.vehicle);

        assignedDriver = assignedDriver || pick(found.assignedDriver);
        assignedReporter = assignedReporter || pick(found.assignedReporter);

        if (!camOps) {
          const fOps = found.assignedCamOps;
          camOps = Array.isArray(fOps) ? fOps.filter(Boolean).join(", ") : pick(fOps);
        }

        camCount = camCount || pick(found.camCount);
      }

      // --- 3) If still missing basics, try to parse New Request message format ---
      // "title • 2026-02-08 21:25 • Unity House"
      if ((!date || !location) && rawMsg.includes("•")) {
        const parts = rawMsg.split("•").map((p) => pick(p));
        // parts[1] looks like "2026-02-08 21:25" (we store date separately normally, so keep as “Date/Time”)
        const dt = parts[1] || "";
        const loc = parts[2] || "";
        if (!location && loc) location = loc;
        if (!date && dt) date = dt; // still useful in toast even if not perfect
      }

      // --- Build compact readable line ---
      if (date) bits.push(`Date: ${date}`);
      if (location) bits.push(`Location: ${location}`);

      // Times
      if (filmingTime && departureTime) bits.push(`Time: ${departureTime} → ${filmingTime}`);
      else if (filmingTime) bits.push(`Filming: ${filmingTime}`);
      else if (departureTime) bits.push(`Departure: ${departureTime}`);

      // Assignments
      if (assignedReporter) bits.push(`${assignedReporter}`);
      if (assignedDriver) bits.push(`Driver: ${assignedDriver}`);
      if (vehicle) bits.push(`Vehicle: ${vehicle}`);

      // Cameras / cam ops
      if (camCount && camOps) bits.push(`Cams/Ops: ${camCount} | ${camOps}`);
      else if (camCount) bits.push(`Cameras: ${camCount}`);
      else if (camOps) bits.push(`Cam Ops: ${camOps}`);

      // ID if we have it
      if (possibleId) bits.push(`Ticket ID: ${possibleId}`);

      return bits.length ? bits.join(" • ") : "";
    } catch {
      return "";
    }
  };

   const [debugBanner, setDebugBanner] = useState(null);

  // ✅ Per-session dedupe bucket (prevents double toasts from poll + event)
  const handledNotifKeysRef = useRef(new Set());

  /* ===========================
     🧭 Toast click routing starts here
     - Click toast body → navigate to relevant page
     - Click close X (button) → does NOT navigate
     =========================== */
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

  const resolveToastRoute = (note, category) => {
    try {
      const c = String(category || "admin").toLowerCase();

      if (c === "ticket") return "/tickets";
      if (c === "fleet") return "/fleet";
      if (c === "roster") return "/operations";

      if (c === "suggestion") return "/admin?tab=history";

      // Password reset request → User Management highlight
      // Supports either note.action.userId / note.action.userName
      if (c === "password-reset-request" || c === "password_reset_request") {
        const uid = note?.action?.userId ? String(note.action.userId) : "";
        const uname = note?.action?.userName ? String(note.action.userName) : "";
        if (uid) return `/admin?tab=user-management&highlight=${encodeURIComponent(uid)}`;
        if (uname) return `/admin?tab=user-management&highlightName=${encodeURIComponent(uname)}`;
        return "/admin?tab=user-management";
      }

      // Default: admin/user notifications → My Profile (your route is /profile)
      return "/profile";
    } catch {
      return "/profile";
    }
  };
  /* ===========================
     🧭 Toast click routing ends here
     =========================== */

  const fireGlobalAlert = useCallback(
    async (note) => {
      if (!note) return;

      // ✅ Hard gate: if we already know this doesn't match the logged-in user, never alert
      if (note.__recipientMatch === false) {
        try {
          setDebugBanner({
            at: new Date().toISOString(),
            source: note.__source || "unknown",
            key: "",
            toastEnabled:
              localStorage.getItem("notificationToastsEnabled") !== "false",
            soundEnabled:
              localStorage.getItem("notificationSoundsEnabled") !== "false",
            urgent: !!note.urgent,
            category: String(note.category || "admin").toLowerCase(),
            title: note.title || "",
            hasRecipientMatch: false,
            note: "Skipped: recipient mismatch",
          });
        } catch {
          // ignore
        }
        return;
      }

      const toastEnabled =
        localStorage.getItem("notificationToastsEnabled") !== "false";
      const soundEnabled =
        localStorage.getItem("notificationSoundsEnabled") !== "false";

      const urgent = !!note.urgent;

      // ✅ Category normalization (keeps soundRouter + prefs stable)
      // - ticket sound triggers ONLY on category === "ticket"
      // - suggestions/admin variants normalize cleanly
      const normalizeCategory = (raw) => {
        const c = String(raw || "admin").trim().toLowerCase();

        if (c === "tickets") return "ticket";
        if (c === "suggestions") return "suggestion";

        // Optional safety aliases (won't change behavior unless you emit these later)
        if (c === "leaves") return "leave";

        // Keep both styles supported
        if (c === "password_reset_request") return "password-reset-request";

        return c;
      };

      const category = normalizeCategory(note.category);

      // ✅ Use the best timestamp available
      const rawTs = note.timestamp || note._ts || note.ts;
      const noteTs = new Date(rawTs || 0).getTime();

      // ✅ Persistent “already alerted up to here” guard (survives refresh)
      const LAST_SEEN_KEY = "loBoard.lastSeenNotifTs.global";
      const lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);

      // ✅ Build a stable key for per-session dedupe (poll + push + double events)
      const key = makeNotifKey({
        timestamp: note.timestamp,
        title: note.title,
        message: note.message,
        fallbackTs: note._ts || note.ts,
      });

      // ✅ Session dedupe first
      if (handledNotifKeysRef.current.has(key)) return;

      // ✅ IMPORTANT:
      // Local UI events (like TicketForm emit) MUST always show instantly.
      // They should NOT be blocked by lastSeen (which is meant for poll/push refresh safety).
      const bypassLastSeen =
        note?.__forceImmediate === true ||
        note?.__source === "event" ||
        note?.__source === "form";

      // ✅ Refresh-safe guard second (prevents re-toast/re-sound after reload)
      if (!bypassLastSeen) {
        if (Number.isFinite(noteTs) && noteTs > 0 && noteTs <= lastSeen) {
          try {
            setDebugBanner({
              at: new Date().toISOString(),
              source: note.__source || "unknown",
              key,
              toastEnabled,
              soundEnabled,
              urgent,
              category,
              title: note.title || "",
              hasRecipientMatch: true,
              note: `Skipped: <= lastSeen (${new Date(lastSeen).toISOString()})`,
            });
          } catch {
            // ignore
          }
          return;
        }
      }

      // ✅ Mark as handled for this session immediately (prevents double fires)
      handledNotifKeysRef.current.add(key);

      // ✅ Debug stamp (always)
      try {
        setDebugBanner({
          at: new Date().toISOString(),
          source: note.__source || "unknown",
          key,
          toastEnabled,
          soundEnabled,
          urgent,
          category,
          title: note.title || "",
          hasRecipientMatch: true,
          note: note.__note || "",
        });
      } catch {
        // ignore
      }

      if (toastEnabled) {
        const extras = buildTicketToastExtras(note);
        const base = note.message || "";

        // ✅ If it's a ticket-related notification, append structured info
        const description =
          extras && base ? `${base}\n${extras}` : extras ? extras : base;

        const route = resolveToastRoute(note, category);

        toast({
          title: note.title || "New notification",
          description,
          variant: urgent ? "destructive" : undefined,
          className: "cursor-pointer",
          onClick: (evt) => {
            if (shouldIgnoreToastClick(evt)) return;
            navigate(route);
          },
        });
      }

      // ✅ Self rule: if I triggered it, I still get a toast confirmation, but NO sound.
      const actorName = String(note?.actor || "").trim();
      const realSelfName = String(loggedInUser?.name || "").trim();
      const isSelfActor =
        !!actorName && !!realSelfName && actorName === realSelfName;

      if (soundEnabled && !isSelfActor) {
        try {
          await playSoundFor({
            category,
            urgent,
            scope: "global",
            label: note.action || note.label || note.state || note.eventLabel,
          });
        } catch {
          // ignore
        }
      }

      // ✅ Advance persistent last-seen AFTER we’ve “processed” the note
      // ❗ For local forced-immediate events, we still advance lastSeen safely (helps dedupe)
      try {
        if (Number.isFinite(noteTs) && noteTs > 0) {
          const next = Math.max(lastSeen, noteTs);
          localStorage.setItem(LAST_SEEN_KEY, String(next));
        }
      } catch {
        // ignore
      }
    },
    [toast, loggedInUser?.name, tickets, navigate]
  );


  // ✅ NEW: Global notifications wiring (POLL + PUSH + EVENTS) lives here
  // ✅ IMPORTANT: Uses effectiveUser (Admin "View As") for filtering + matching
  // ✅ Token sync is moved to its own effect so View As does NOT re-request permission
  useEffect(() => {
    const myName = String(effectiveUser?.name || "").trim();
    const myId = String(effectiveUser?.id || "").trim();

    if (!myName) {
      setDebugBanner({
        at: new Date().toISOString(),
        source: "bootstrap",
        key: "",
        toastEnabled:
          localStorage.getItem("notificationToastsEnabled") !== "false",
        soundEnabled:
          localStorage.getItem("notificationSoundsEnabled") !== "false",
        urgent: false,
        category: "admin",
        title: "",
        hasRecipientMatch: false,
        note: "No effectiveUser.name – global alerts disabled",
      });
      return;
    }

    let cancelled = false;

    const syncUnread = (visibleList) => {
      try {
        const n = Array.isArray(visibleList) ? visibleList.length : 0;
        localStorage.setItem("loBoard.unreadCount", String(n));
        window.dispatchEvent(new CustomEvent("loBoard:unread"));
      } catch {
        // ignore
      }
    };

    /* ===========================
   📣 NotificationsPanel → App.jsx event bridge starts here
   Listens for: window.dispatchEvent(new CustomEvent("loBoard:notify", { detail: note }))
   Routes into: fireGlobalAlert(note)

   ✅ DEDUPE RULE (IMPORTANT):
   - We ONLY use this bridge for *admin local preview* (the sender).
   - Real delivery to recipients must come from backend (/notifications + push/poll).
   - Prevents double notifications (event + push/poll).
   =========================== */
const onLocalNotifyEvent = (evt) => {
  try {
    const note = evt?.detail || null;

    // ✅ Debug: proves the listener is actually firing
    console.log("📣 loBoard:notify received in App.jsx:", note);

    if (!note) return;

    // ✅ Only allow "admin preview" events through this bridge.
    // If not explicitly marked, skip to prevent duplicates.
    const isAdminPreview =
      note?.__localPreview === true ||
      note?.__mode === "admin_preview" ||
      note?.__recipientMatch === "admin_preview";

    if (!isAdminPreview) {
      // This notification will arrive via backend push/poll instead.
      return;
    }

    // ✅ CLASSIC MODE:
    // Preview events must ALWAYS show immediately (for the sender/admin).
    fireGlobalAlert({
      ...note,
      __source: note.__source || "event",
      __recipientMatch: true,
      __note: "From loBoard:notify event (admin preview only)",
      __forceImmediate: true,
    });
  } catch (err) {
    console.log("📣 loBoard:notify handler error:", err);
  }
};

try {
  window.addEventListener("loBoard:notify", onLocalNotifyEvent);
} catch {
  // ignore
}
/* ===========================
   📣 NotificationsPanel → App.jsx event bridge ends here
   =========================== */

const poll = async () => {
  // 💤 Skip when tab is hidden to reduce network/battery
  if (document.hidden) return;

  try {
    /* ===========================
       🔄 Polling watermark starts here
       =========================== */
    const LAST_SEEN_KEY = "loBoard.lastSeenNotifTs.global";

    const now = Date.now();
    let lastSeen = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);

    // ✅ If lastSeen is somehow in the future (device clock / old bad value),
    // reset it so users don't miss all live toasts forever.
    if (Number.isFinite(lastSeen) && lastSeen > now + 5 * 60 * 1000) {
      lastSeen = 0;
      localStorage.setItem(LAST_SEEN_KEY, "0");
    }

    const afterISO =
      lastSeen > 0
        ? new Date(lastSeen).toISOString()
        : new Date(0).toISOString();
    /* ===========================
       🔄 Polling watermark ends here
       =========================== */

    const res = await fetch(
      `${API_BASE}/notifications?after=${encodeURIComponent(afterISO)}`
    );

    if (!res.ok) {
      setDebugBanner((prev) => ({
        ...(prev || {}),
        at: new Date().toISOString(),
        source: "poll",
        note: `Fetch failed (${res.status})`,
      }));
      return;
    }

    const all = await res.json().catch(() => []);
    const list = Array.isArray(all) ? all : [];

    const mine = list.filter((n) => {
      const section = String(
        effectiveUser?.section || effectiveUser?.description || effectiveUser?.team || ""
      ).trim();

      return recipientsMatchUser({
        recipients: n?.recipients,
        userName: myName,
        userId: myId,
        userRoles: effectiveUser?.roles || [],
        userSection: section,
      });
    });

    // ✅ Apply local dismiss filters (same behavior as before)
    const dismissedRaw =
      JSON.parse(localStorage.getItem("dismissedNotifications") || "[]") || [];
    const dismissed = new Set(
      Array.isArray(dismissedRaw) ? dismissedRaw.filter(Boolean) : []
    );

    const visible = mine
      .filter((n) => {
        const k = makeNotifKey({
          timestamp: n?.timestamp,
          title: n?.title,
          message: n?.message,
          fallbackTs: n?._ts || n?.ts,
        });
        return !dismissed.has(k);
      })
      .sort((a, b) => {
        const ta = new Date(a?.timestamp || 0).getTime();
        const tb = new Date(b?.timestamp || 0).getTime();
        return tb - ta;
      });

    // ✅ Update unread bubble count from what we got
    syncUnread(visible);

    // ✅ Fire alerts for the NEW batch only
    let maxTs = lastSeen;

    for (const n of visible) {
      if (cancelled) break;

      const ts = new Date(n?.timestamp || n?._ts || n?.ts || 0).getTime();
      if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;

      await fireGlobalAlert({
        ...n,
        __source: "poll",
        __recipientMatch: true,
      });
    }

    // ✅ Advance watermark based on what we processed
    if (Number.isFinite(maxTs) && maxTs > lastSeen) {
      localStorage.setItem(LAST_SEEN_KEY, String(maxTs));
    }

    setDebugBanner((prev) => ({
      ...(prev || {}),
      at: new Date().toISOString(),
      source: "poll",
      note: `OK (+${visible.length} new)`,
    }));
  } catch (err) {
    setDebugBanner((prev) => ({
      ...(prev || {}),
      at: new Date().toISOString(),
      source: "poll",
      note: err?.message || "Poll error",
    }));
  }
};

/* ===========================
   🧯 FCM foreground listener disabled (classic mode)
   - We’re intentionally focusing on classic Poll + Local Event toasts/sounds.
   - Once classic is stable, we can re-enable FCM to call fireGlobalAlert()
     without rewiring UI again.
   =========================== */
let unsubscribe = null;
/*
try {
  unsubscribe = onMessage((payload) => {
    try {
      const title =
        payload?.notification?.title ||
        payload?.data?.title ||
        "New notification";

      const message =
        payload?.notification?.body ||
        payload?.data?.message ||
        payload?.data?.body ||
        "";

      const category = payload?.data?.category || "admin";
      const urgent =
        payload?.data?.urgent === "true" || payload?.data?.urgent === true;

      // ✅ recipients parsing (unchanged behavior)
      let recipients = [];
      const rawRec = payload?.data?.recipients;
      if (typeof rawRec === "string") {
        try {
          const parsed = JSON.parse(rawRec);
          recipients = Array.isArray(parsed) ? parsed : [];
        } catch {
          recipients = rawRec
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      } else if (Array.isArray(rawRec)) {
        recipients = rawRec;
      }

      const section = String(
        effectiveUser?.section || effectiveUser?.description || effectiveUser?.team || ""
      ).trim();

      const matches = recipientsMatchUser({
        recipients,
        userName: myName,
        userId: myId,
        userRoles: effectiveUser?.roles || [],
        userSection: section,
      });

      const d = payload?.data || {};
      const ticketId =
        d.ticketId || d.id || d.ticket_id || d.ticketID || d._id || "";

      let assignedCamOps = [];
      if (typeof d.assignedCamOps === "string" && d.assignedCamOps.trim()) {
        try {
          const parsed = JSON.parse(d.assignedCamOps);
          assignedCamOps = Array.isArray(parsed) ? parsed : [];
        } catch {
          assignedCamOps = d.assignedCamOps
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      } else if (Array.isArray(d.assignedCamOps)) {
        assignedCamOps = d.assignedCamOps;
      }

      fireGlobalAlert({
        title,
        message,
        category,
        urgent,
        timestamp: d.timestamp || new Date().toISOString(),
        recipients,
        ticketId: ticketId || undefined,
        __ticket: {
          id: ticketId || undefined,
          date: d.date || d.ticketDate || undefined,
          filmingTime: d.filmingTime || d.ticketFilmingTime || undefined,
          departureTime: d.departureTime || d.ticketDepartureTime || undefined,
          location: d.location || d.ticketLocation || undefined,
          vehicle: d.vehicle || d.ticketVehicle || undefined,
          camCount: d.camCount || d.cameras || undefined,
          assignedDriver: d.assignedDriver || d.driver || undefined,
          assignedReporter: d.assignedReporter || d.reporter || undefined,
          assignedCamOps: assignedCamOps.length ? assignedCamOps : undefined,
        },
        __source: "push",
        __recipientMatch: matches,
      });
    } catch {
      // ignore
    }
  });
} catch {
  unsubscribe = null;
}
*/

// ✅ Run an immediate poll so View As updates instantly
poll();

// ✅ Poll every 8 seconds (same as before)
const interval = setInterval(poll, 8000);

return () => {
  cancelled = true;

  try {
    window.removeEventListener("loBoard:notify", onLocalNotifyEvent);
  } catch {
    // ignore
  }

  try {
    if (typeof unsubscribe === "function") unsubscribe();
  } catch {
    // ignore
  }

  try {
    clearInterval(interval);
  } catch {
    // ignore
  }
};
}, [
effectiveUser?.name,
effectiveUser?.id,
JSON.stringify(effectiveUser?.roles || []),
effectiveUser?.section,
effectiveUser?.description,
adminViewAs ? JSON.stringify(adminViewAs) : "",
fireGlobalAlert,
]);

  /* ===========================
     🔔 FCM token sync starts here
     - Requests permission (your existing firebase helper)
     - If a token is returned, save it to backend:
       PATCH /users/:id/fcmToken { fcmToken }
     - Deduped per user+token (prevents spam on refresh)
     ✅ IMPORTANT: Always uses REAL loggedInUser (not View As)
     =========================== */
  useEffect(() => {
    if (!loggedInUser?.id || !String(loggedInUser?.id).trim()) return;

    try {
      const maybePromise = requestPermission(loggedInUser);

      Promise.resolve(maybePromise)
        .then(async (token) => {
          const userId = String(loggedInUser?.id || "").trim();
          const fcmToken = String(token || "").trim();
          if (!userId || !fcmToken) return;

          const CACHE_KEY = `loBoard.fcmToken.${userId}`;
          const last = String(localStorage.getItem(CACHE_KEY) || "").trim();

          // ✅ If the token didn’t change, don’t hit backend again
          if (last === fcmToken) return;

          try {
            const res = await fetch(`${API_BASE}/users/${userId}/fcmToken`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fcmToken }),
            });

            if (res.ok) {
              localStorage.setItem(CACHE_KEY, fcmToken);
              localStorage.setItem(
                `loBoard.fcmTokenSavedAt.${userId}`,
                new Date().toISOString()
              );
            } else {
              // Keep silent; token saving shouldn't break the app
              console.warn("FCM token save failed:", res.status);
            }
          } catch {
            // ignore network issues
          }
        })
        .catch(() => {
          // ignore token/permission errors
        });
    } catch {
      // ignore
    }
  }, [loggedInUser?.id, loggedInUser?.name]);
  /* ===========================
     🔔 FCM token sync ends here
     =========================== */

    // ✅ Heartbeat that stamps "lastOnline" for the logged-in user
  const onlineHeartbeatRef = useRef(null);

  // ✅ If backend route is missing, disable heartbeats for this session to avoid spam
  const lastOnlineDisabledRef = useRef(false);

  /* ===========================
     🟢 Last-online heartbeat starts here
     - Fixes: "I'm logged in but lastOnline didn't change"
     - Works even when session is restored from localStorage (no /auth/login call)
     - Auto-disables for the session if backend route is missing (404/405) to prevent spam
     =========================== */

  // ✅ Enable safely (we self-disable on missing route)
  const ENABLE_LAST_ONLINE = true;

  useEffect(() => {
    if (!ENABLE_LAST_ONLINE) return;

    // Clear any existing timer first
    if (onlineHeartbeatRef.current) {
      clearInterval(onlineHeartbeatRef.current);
      onlineHeartbeatRef.current = null;
    }

    // Reset session disable when user changes
    lastOnlineDisabledRef.current = false;

    const userId = String(loggedInUser?.id || "").trim();
    if (!userId) return;

    const ping = async (source = "heartbeat") => {
      try {
        if (lastOnlineDisabledRef.current) return;

        const res = await fetch(`${API_BASE}/users/${userId}/last-online`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastOnline: new Date().toISOString(), source }),
        });

        // If route doesn't exist on some environment, disable for this session.
        if (res.status === 404 || res.status === 405) {
          lastOnlineDisabledRef.current = true;
          return;
        }
      } catch {
        // Silent: network hiccups shouldn't spam console
      }
    };

    // ✅ Stamp immediately on mount/restore, then every 5 minutes
    ping("mount");
    onlineHeartbeatRef.current = setInterval(() => ping("interval"), 5 * 60 * 1000);

    return () => {
      if (onlineHeartbeatRef.current) {
        clearInterval(onlineHeartbeatRef.current);
        onlineHeartbeatRef.current = null;
      }
    };
  }, [ENABLE_LAST_ONLINE, loggedInUser?.id]);

  /* ===========================
     🟢 Last-online heartbeat ends here
     =========================== */


    /* ===========================
     📦 Changelog Dialog logic starts
     - ✅ Version is controlled by backend changelog.json (latestVersion)
     - Shows once per user per latestVersion
     - Uses effectiveUser so Admin "View As" behaves correctly
     - Skips public routes (login/reset)
     =========================== */

  // ✅ Backend changelog doc (source of truth)
  const [changelogDoc, setChangelogDoc] = useState(null);

  // ✅ Visible “app version” is whatever backend says is latestVersion
  const releaseVersion = String(changelogDoc?.latestVersion || "").trim();

  // ✅ Helper: pick the latest item by version match (preferred) or fallback to first item
  const latestChangelogItem = (() => {
    const items = Array.isArray(changelogDoc?.items) ? changelogDoc.items : [];
    if (!items.length) return null;

    const exact = items.find((it) => String(it?.version || "").trim() === releaseVersion);
    return exact || items[0] || null;
  })();

  // ✅ Fetch changelog doc once (and whenever base URL changes)
  useEffect(() => {
    let cancelled = false;

    const loadChangelog = async () => {
      try {
        const res = await fetch(`${API_BASE}/changelog`);
        if (!res.ok) throw new Error(`Failed to load changelog (${res.status})`);
        const data = await res.json().catch(() => null);

        if (cancelled) return;

        const latestVersion = String(data?.latestVersion || "").trim();
        const items = Array.isArray(data?.items) ? data.items : [];

        setChangelogDoc({ latestVersion, items });
      } catch (err) {
        // Silent fallback: keep UI stable even if endpoint is down
        if (!cancelled) setChangelogDoc(null);
      }
    };

    loadChangelog();

    return () => {
      cancelled = true;
    };
  }, []);

  const [showChangelog, setShowChangelog] = useState(false);

  const changelogStorageKey = (() => {
    try {
      const u = effectiveUser;
      const ident =
        u?.id || u?.userId || u?.email || u?.name || loggedInUser?.name || "anon";
      return `loBoard.lastSeenChangelogVersion::${String(ident).trim()}`;
    } catch {
      return "loBoard.lastSeenChangelogVersion::anon";
    }
  })();

  useEffect(() => {
    try {
      // Never show on login/reset pages
      if (hideLayout) return;

      // Only evaluate once we actually have a user
      if (!effectiveUser) return;

      // Only evaluate once we have a backend version
      if (!releaseVersion) return;

      const lastSeen = localStorage.getItem(changelogStorageKey) || "";
      if (String(lastSeen) !== String(releaseVersion)) {
        setShowChangelog(true);
      }
    } catch {
      // ignore
    }
  }, [hideLayout, effectiveUser, changelogStorageKey, releaseVersion]);

  const handleCloseChangelog = useCallback(() => {
    try {
      if (releaseVersion) {
        localStorage.setItem(changelogStorageKey, String(releaseVersion));
      }
    } catch {
      // ignore
    }
    setShowChangelog(false);
  }, [changelogStorageKey, releaseVersion]);

  /* ===========================
     📦 Changelog Dialog logic ends
     =========================== */
  return (
    <>
           {!hideLayout && (
        <Navbar
          loggedInUser={loggedInUser}
          setLoggedInUser={setLoggedInUser}
          users={users}
          adminViewAs={adminViewAs}
          setAdminViewAs={setAdminViewAs}
          effectiveUser={effectiveUser}
        />
      )}

          <div className="p-4 min-h-[80vh]">
        <Routes>
          <Route
            path="/"
            element={
              loggedInUser ? (
                <HomeCarousel
                  tickets={tickets}
                  users={users}
                  vehicles={vehicles}
                  loggedInUser={loggedInUser}
                  setTickets={setTickets}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* ===========================
             🏢 Team Hubs (NEW)
             =========================== */}
          {/*
            ===========================
            🔓 Team Hubs access gate (OPEN)
            - All logged-in users may access:
              /newsroom, /sports, /production
            - Still respects Admin "View As" via effectiveUser
            ===========================
          */}
          {(() => {
            const canAccessTeamHubs = true;

            return (
              <>
                <Route
                  path="/newsroom"
                  element={
                    loggedInUser ? (
                      canAccessTeamHubs ? (
                        <NewsroomPage
                          loggedInUser={effectiveUser} // safe for View As
                          realLoggedInUser={loggedInUser} // safe extra prop (ignored if unused)
                          users={users} // safe extra prop (ignored if unused)
                        />
                      ) : (
                        <Navigate to="/" replace />
                      )
                    ) : (
                      <Navigate to="/login" replace />
                    )
                  }
                />

                <Route
                  path="/sports"
                  element={
                    loggedInUser ? (
                      canAccessTeamHubs ? (
                        <SportsPage
                          loggedInUser={effectiveUser}
                          realLoggedInUser={loggedInUser}
                          users={users}
                        />
                      ) : (
                        <Navigate to="/" replace />
                      )
                    ) : (
                      <Navigate to="/login" replace />
                    )
                  }
                />

                <Route
                  path="/production"
                  element={
                    loggedInUser ? (
                      canAccessTeamHubs ? (
                        <ProductionPage
                          loggedInUser={effectiveUser}
                          realLoggedInUser={loggedInUser}
                          users={users}
                        />
                      ) : (
                        <Navigate to="/" replace />
                      )
                    ) : (
                      <Navigate to="/login" replace />
                    )
                  }
                />
              </>
            );
          })()}

          <Route
            path="/operations"
            element={
              loggedInUser ? (
                <OperationsPage
                  users={users}
                  setUsers={setUsers}
                  tickets={tickets}
                  loggedInUser={loggedInUser}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="/profile"
            element={
              loggedInUser ? (
                <MyProfile
                  loggedInUser={effectiveUser}
                  realLoggedInUser={loggedInUser} // safe extra prop (ignored if unused)
                  adminViewAs={adminViewAs}       // safe extra prop (ignored if unused)
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="/fleet"
            element={
              loggedInUser ? (
                <FleetPage
                  vehicles={vehicles}
                  setVehicles={setVehicles}
                  loggedInUser={loggedInUser}
                  tickets={tickets}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="/admin"
            element={
              loggedInUser?.roles?.includes("admin") ? (
                <AdminPage
                  users={users}
                  setUsers={setUsers}
                  loggedInUser={loggedInUser}
                />
              ) : loggedInUser ? (
                <HomeCarousel
                  tickets={tickets}
                  users={users}
                  loggedInUser={loggedInUser}
                  setTickets={setTickets}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="/login"
            element={<LoginPage users={users} setLoggedInUser={setLoggedInUser} />}
          />

          {/* ✅ New: password reset flow */}
          <Route path="/forgot" element={<ForgotPassword />} />
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="/set-password" element={<SetPasswordPage />} />

          <Route
            path="/tickets"
            element={
              loggedInUser ? (
                <TicketPage
                  tickets={tickets}
                  setTickets={setTickets}
                  archivedTickets={archivedTickets}
                  setArchivedTickets={setArchivedTickets}
                  deletedTickets={deletedTickets}
                  setDeletedTickets={setDeletedTickets}
                  users={users}
                  vehicles={vehicles}
                  loggedInUser={loggedInUser}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="/create"
            element={
              loggedInUser ? (
                <TicketForm
                  users={users}
                  tickets={tickets}
                  setTickets={setTickets}
                  loggedInUser={loggedInUser}
                  vehicles={vehicles}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          <Route
            path="*"
            element={
              loggedInUser ? (
                <HomeCarousel
                  tickets={tickets}
                  users={users}
                  vehicles={vehicles}
                  loggedInUser={loggedInUser}
                  setTickets={setTickets}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
        </Routes>
           </div>
      {!hideLayout && <Footer appVersion={changelogDoc?.latestVersion} />}

   {loggedInUser && !hideLayout && (
  <ChangelogDialog
    open={showChangelog}
    onClose={handleCloseChangelog}
    version={changelogDoc?.latestVersion}
    entry={latestChangelogItem}
  />
)}
      <Toaster toastOptions={{ position: "top-center" }} />
    </>
  );
}



export default AppWrapper;
