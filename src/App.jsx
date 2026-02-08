import { useState, useEffect, useRef, useCallback } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
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
import { useToast } from "@/hooks/use-toast"
import MyProfile from "@/pages/MyProfile";
import ChangelogDialog from "@/components/ChangelogDialog";
import { requestPermission, onMessage } from "@/lib/firebase";
import AdminGlobalToasts from "@/components/AdminGlobalToasts";
import { playSoundFor, installSoundUnlockOnGesture } from "@/lib/soundRouter";


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
  const hideLayout = ["/login", "/set-password", "/forgot", "/reset"].includes(
    location.pathname
  );
  const { toast } = useToast();

    // ✅ Install one global "unlock audio" handler (fixes Chrome autoplay restrictions)
  useEffect(() => {
    installSoundUnlockOnGesture();
  }, []);


    // ============================================================
  // 🔔 Global alert helper (single source of truth)
  // - Dedupes across Push (onMessage) + Poll (/notifications) + Local Emits
  // - Respects global toggles
  // - Sound plays ONLY for global notifications
  // ============================================================

  /* ===========================
     🔊 Global Toast/Sound starts here
     All app-wide toast + sound triggers are routed ONLY inside this section.
     =========================== */

  const handledNotifKeysRef = useRef(new Set()); // session-only dedupe

  const makeNotifKey = ({ timestamp, title, message, fallbackTs }) => {
    // Prefer stable server key: "YYYY-MM-DDTHH:mm:ssZ"
    if (timestamp) {
      try {
        return new Date(timestamp).toISOString().split(".")[0] + "Z";
      } catch {
        // ignore
      }
    }

    if (fallbackTs) return String(fallbackTs);

    // Fallback: title|message (not perfect, but prevents quick doubles)
    return `${String(title || "").trim()}|${String(message || "").trim()}`;
  };

  const [debugBanner, setDebugBanner] = useState(null);

  const fireGlobalAlert = useCallback(
  async (note) => {
    if (!note) return;

    // 🧪 DEBUG: mark that a GLOBAL notification fired
    setDebugBanner({
      title: note.title || "Untitled notification",
      ts: new Date().toLocaleTimeString(),
    });

    // auto-clear after 3s
    setTimeout(() => setDebugBanner(null), 3000);

    const toastEnabled =
      localStorage.getItem("notificationToastsEnabled") !== "false";
    const soundEnabled =
      localStorage.getItem("notificationSoundsEnabled") !== "false";

    const urgent = !!note.urgent;
    const category = String(note.category || "admin").toLowerCase();

    const key = makeNotifKey({
      timestamp: note.timestamp,
      title: note.title,
      message: note.message,
      fallbackTs: note._ts || note.ts,
    });

    // ✅ Dedupes across poll + push + local emits
    if (handledNotifKeysRef.current.has(key)) return;
    handledNotifKeysRef.current.add(key);

    // -----------------------------
    // ✅ GLOBAL RULE: self action = toast only (no sound), regardless of role
    // -----------------------------
    const actorRaw =
      note.actor ??
      note.createdBy ??
      note.sender ??
      note.from ??
      note.author ??
      note.by;

    const actor = String(actorRaw || "").trim().toLowerCase();
    const me = String(loggedInUser?.name || "").trim().toLowerCase();

    const isSelf = !!me && !!actor && actor === me;

    // -----------------------------
    // ✅ Ticket toast formatting (rich info when available)
    // -----------------------------
    const t = note.ticket || null;

    const fmtTimeLine = () => {
      const date = t?.date || t?.shootDate || t?.day || "";
      const filming = t?.filmingTime || "";
      const depart = t?.departureTime || "";
      const bits = [];

      if (date) bits.push(`📅 ${date}`);
      if (filming && depart) bits.push(`⏱️ Film ${filming} • Depart ${depart}`);
      else if (filming) bits.push(`⏱️ Film ${filming}`);
      else if (depart) bits.push(`⏱️ Depart ${depart}`);

      return bits.join("\n");
    };

    const fmtAssignments = () => {
      const lines = [];

      const loc = t?.location || t?.address || "";
      if (loc) lines.push(`📍 ${loc}`);

      const status = t?.status || t?.assignmentStatus || "";
      if (status) lines.push(`✅ Status: ${status}`);

      const camOps = Array.isArray(t?.assignedCamOps)
        ? t.assignedCamOps.filter(Boolean)
        : [];
      if (camOps.length) lines.push(`🎥 Cam Ops: ${camOps.join(", ")}`);

      const driver = t?.assignedDriver || "";
      if (driver) lines.push(`🚗 Driver: ${driver}`);

      const vehicleLabel =
        typeof t?.vehicle === "string"
          ? t.vehicle
          : t?.vehicle?.name || t?.vehicle?.label || "";
      const plate = t?.vehicle?.licensePlate || t?.licensePlate || "";
      if (vehicleLabel || plate) {
        lines.push(
          `🚙 Vehicle: ${[vehicleLabel, plate ? `(${plate})` : ""]
            .filter(Boolean)
            .join(" ")}`
        );
      }

      const reporter = t?.assignedReporter || "";
      if (reporter) lines.push(`📰 ${reporter}`);

      return lines.join("\n");
    };

    const ticketDetails =
      category === "ticket" && t
        ? [fmtTimeLine(), fmtAssignments()].filter(Boolean).join("\n")
        : "";

    // -----------------------------
    // ✅ Auto-dismiss rules
    // - Urgent ADMIN messages should NOT auto-disappear
    // - Everything else auto-disappears
    // -----------------------------
    const stickyUrgentAdmin = urgent && category !== "ticket";
    const duration = stickyUrgentAdmin ? 1000000 : category === "ticket" ? 6500 : 5000;

    if (toastEnabled) {
      toast({
        title: note.title || (category === "ticket" ? "Ticket update" : "New notification"),
        description:
          ticketDetails ||
          note.message ||
          "",
        variant: urgent ? "destructive" : undefined,
        duration,
      });
    }

    // ✅ Only play sound if it is NOT your own action
    if (soundEnabled && !isSelf) {
      try {
        await playSoundFor({
          category: note.category || "admin",
          urgent,
          scope: "global",
        });
      } catch {
        // ignore
      }
    }
  },
  [toast, loggedInUser?.name]
);

  // ============================================================
  // 📡 Local Emit Listener (Tickets + any other feature emits)
  // Listens for:
  // - window CustomEvent("loBoard:notify", { detail: note })
  // - BroadcastChannel "loBoard" messages: { type:"notify", note }
  // Routes all incoming notes into fireGlobalAlert (dedupe stays inside helper)
  // ============================================================
  useEffect(() => {
    const onNotifyEvent = (e) => {
      const note = e?.detail;
      if (!note) return;
      fireGlobalAlert(note);
    };

    // 🎟️ TicketPage emits: window CustomEvent("loBoard:ticketEvent", { detail })
    // Bridge ticketEvent detail → global "note" shape (so it reuses dedupe + toast + sound)
    const onTicketEvent = (e) => {
  const d = e?.detail;
  if (!d) return;

  // We accept either:
  // - detail.ticket (recommended)
  // - detail.payload / detail.data (fallback)
  const ticket = d.ticket || d.payload || d.data || null;

  // Build a better message fallback if ticket is not included
  const fallbackMsgParts = [];
  if (d.message) fallbackMsgParts.push(d.message);
  if (!d.message && ticket?.location) fallbackMsgParts.push(`📍 ${ticket.location}`);
  const fallbackMsg = fallbackMsgParts.join("\n");

  fireGlobalAlert({
    title: d.title || "Ticket update",
    message: fallbackMsg || "",
    category: "ticket",
    urgent: !!d.urgent,
    ticket, // ✅ this is what enables rich ticket toast details
    actor: d.actor || ticket?.updatedBy || ticket?.createdBy || ticket?.actor,
    // Prefer ISO timestamp for stable dedupe key
    timestamp:
      d.timestamp ||
      (d.ts ? new Date(d.ts).toISOString() : new Date().toISOString()),
    // Keep a fallback numeric ts too (optional)
    ts: d.ts || Date.now(),
  });
};

    window.addEventListener("loBoard:notify", onNotifyEvent);
    window.addEventListener("loBoard:ticketEvent", onTicketEvent);

    let ch = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        ch = new BroadcastChannel("loBoard");
        ch.onmessage = (ev) => {
          const data = ev?.data;
          if (!data) return;

          if (data.type === "notify" && data.note) {
            fireGlobalAlert(data.note);
          }
        };
      } catch {
        // ignore
      }
    }

      return () => {
      window.removeEventListener("loBoard:notify", onNotifyEvent);
      window.removeEventListener("loBoard:ticketEvent", onTicketEvent);
      try {
        if (ch) ch.close();
      } catch {
        // ignore
      }
    };
  }, [fireGlobalAlert]);

  /* =========================
     🔊 Global Toast/Sound ends here
     ========================= */


    useEffect(() => {
    if (
      !loggedInUser &&
      location.pathname !== "/login" &&
      location.pathname !== "/set-password"
    ) {
      navigate("/login");
    }
  }, [loggedInUser, location.pathname, navigate]);

  useEffect(() => {
    fetch(`${API_BASE}/users`)
      .then((res) => res.json())
      .then((data) => setUsers(data))
      .catch((err) => console.error("Failed to load users:", err));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/vehicles`)
      .then((res) => res.json())
      .then((data) => setVehicles(data))
      .catch((err) => console.error("Failed to load vehicles:", err));
  }, []);

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const response = await fetch(`${API_BASE}/tickets`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        setTickets(data);
      } catch (error) {
        console.error("Failed to fetch tickets from backend:", error);
        setTickets([]);
      }
    };

    fetchTickets();
  }, []);

   useEffect(() => {
    localStorage.setItem("loggedInUser", JSON.stringify(loggedInUser));
  }, [loggedInUser]);

  // ✅ Persist adminViewAs when changed via UI (and clear it when not admin)
  useEffect(() => {
    if (!isAdmin) {
      try {
        localStorage.removeItem("adminViewAs");
      } catch {
        // ignore
      }
      if (adminViewAs) setAdminViewAs(null);
      return;
    }

    try {
      if (adminViewAs) localStorage.setItem("adminViewAs", JSON.stringify(adminViewAs));
      else localStorage.removeItem("adminViewAs");
    } catch {
      // ignore
    }
  }, [adminViewAs, isAdmin]);

  // ✅ Sync adminViewAs from localStorage (restores "testing prowess" even when you edit LS manually)
  useEffect(() => {
    if (!isAdmin) return;

    let lastRaw = null;

    const read = () => {
      try {
        const raw = localStorage.getItem("adminViewAs");
        if (raw === lastRaw) return;
        lastRaw = raw;

        const parsed = raw ? JSON.parse(raw) : null;

        // Only update state if it actually changed
        const same =
          (!!parsed && !!adminViewAs && parsed.id === adminViewAs.id) ||
          (!parsed && !adminViewAs);

        if (!same) setAdminViewAs(parsed);
      } catch {
        // If JSON is malformed during manual edits, don't crash the app
      }
    };

    // read immediately, then poll lightly
    read();
    const t = setInterval(read, 800);

    // also listen for cross-tab changes
    const onStorage = (e) => {
      if (e.key === "adminViewAs") read();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      clearInterval(t);
      window.removeEventListener("storage", onStorage);
    };
  }, [isAdmin, adminViewAs]);

  useEffect(() => {
    localStorage.setItem("archivedTickets", JSON.stringify(archivedTickets));
  }, [archivedTickets]);

  useEffect(() => {
    localStorage.setItem("deletedTickets", JSON.stringify(deletedTickets));
  }, [deletedTickets]);

  const requestedPushOnceRef = useRef(false);

  useEffect(() => {
    if (requestedPushOnceRef.current) return; // avoid React 18 dev-mode double-call
    requestedPushOnceRef.current = true;

    (async () => {
      try {
        const token = await requestPermission();
        if (token) {
          console.log("🎯 FCM Token:", token);
          // TODO: optionally POST token to backend to associate with loggedInUser
        } else {
          // Silent: user denied or unsupported; no warning spam
        }
      } catch (err) {
        console.error("Failed to initialize notifications:", err);
      }
    })();
  }, []);

           useEffect(() => {
    const unsubscribe = onMessage((payload) => {
      const { title, body } = payload?.notification || {};
      const data = payload?.data || {};

      if (!title || !body) return;

      const urgent =
        data?.urgent === "true" ||
        data?.urgent === true ||
        data?.priority === "urgent";

      const category = data?.category || "admin";

      // Try to use a stable ts from push data if present
      const ts = data?.ts || data?.timestamp || Date.now();

      fireGlobalAlert({
        title,
        message: body,
        urgent,
        category,
        // Push may not include a server timestamp; use push ts as dedupe key
        _ts: `push:${ts}`,
      });
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [toast, loggedInUser?.id]);

   // Migrate users with legacy 'role' field
  useEffect(() => {
    if (!users?.length) return;

    const migrated = users.map((user) => {
      if (!user.roles && user.role) {
        return { ...user, roles: [user.role], role: undefined };
      }
      return user;
    });

    const needsMigration = migrated.some((u, i) => users[i]?.role);

    // Prevent useless setState loops
    if (needsMigration) setUsers(migrated);
  }, [users]);
   const firedTestPushOnceRef = useRef(false);

  // ✅ Optional: manual test push (DISABLED by default)
  // Turn ON only when you are actively testing push delivery.
  useEffect(() => {
    const ENABLE_TEST_PUSH = false; // 👈 flip to true temporarily when needed
    if (!ENABLE_TEST_PUSH) return;

    if (firedTestPushOnceRef.current) return; // avoid double-fire in dev
    firedTestPushOnceRef.current = true;

    const testPush = async () => {
      // ⚠️ Keep your test token here OR wire in the freshly obtained token.
      const token =
        "cZuEcPz4jfZHlZlJOuFhwm:APA91bGTDvUBe1VVEhu8ZlUWdFkTWHYFBzwa2G8bFWhwSDtrrz0INZSSVkUYrcfSXZps3MamCkp9ihXaiuBUXmu6Bx1VlCmqz2FnhWqpcATBbotYW1SNnA4";

      try {
        const response = await fetch(`${API_BASE}/send-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            title: "🎬 New Ticket Assigned",
            body: "You’ve been assigned to a ticket at Anse Royale!",
            data: { source: "app-test", ts: String(Date.now()) },
          }),
        });

        const result = await response.json().catch(() => ({}));

        if (response.status === 207) {
          console.warn("Push partial success:", result);
        } else if (!response.ok) {
          console.error("Push failed:", result);
        } else {
          console.log("Push OK:", result);
        }
      } catch (err) {
        console.error("Push request error:", err);
      }
    };

    testPush();
  }, []);

   // ============================================================
  // 🔔 Global Notifications Controller (SINGLE SOURCE OF TRUTH)
  // - Polls backend notifications
  // - Respects user prefs from localStorage (set in MyProfile)
  // - Fires toast + sound globally
  // - Updates navbar unread badge
  // ============================================================
  useEffect(() => {
    if (!loggedInUser?.id || !loggedInUser?.name) return;

    // If a controller already exists (React 18 dev / hot reload / relogin),
    // only keep it if it's for the SAME user. Otherwise, tear it down safely.
    try {
      const existing = window.__loBoardNotifController;
      if (existing?.userId && existing.userId !== loggedInUser.id) {
        existing.cleanup?.();
        window.__loBoardNotifController = null;
      }
    } catch {
      // ignore
    }

    // 🚦 Singleton guard (prevents double polling in React 18 dev)
    if (window.__loBoardNotifController?.userId === loggedInUser.id) return;

    const controller = new AbortController();
    const state = {
      bootstrapped: false, // suppress alerts on first successful load
      lastSeenMs: 0,       // track newest notification timestamp we've handled
    };

    const getSectionFromUser = (u) => {
      if (!u) return "N/A";
      const name = (u.name || "").toLowerCase();
      const desc = (u.description || "").toLowerCase();

      if (["clive camille", "jennifer arnephy", "gilmer philoe"].includes(name)) return "Admin";
      if (desc.includes("sports journalist")) return "Sports Section";
      if (desc.includes("journalist")) return "Newsroom";
      if (/cam ?op|camera ?operator|operations/.test(desc)) return "Operations";
      if (desc.includes("producer") || desc.includes("production")) return "Production";

      return u.section || "Unspecified";
    };

    const normalizeDismissed = () => {
      try {
        const raw = JSON.parse(localStorage.getItem("dismissedNotifications") || "[]");
        return new Set(
          raw
            .map((t) => {
              try {
                return new Date(t).toISOString().split(".")[0] + "Z";
              } catch {
                return null;
              }
            })
            .filter(Boolean)
        );
      } catch {
        return new Set();
      }
    };

    const poll = async () => {
      // Skip polling when tab is hidden (saves battery); will refresh on visibilitychange.
      if (document.hidden) return;

      try {
        const [nRes, gRes] = await Promise.all([
          fetch(`${API_BASE}/notifications`, { signal: controller.signal }),
          fetch(`${API_BASE}/notification-groups`, { signal: controller.signal }),
        ]);

        if (!nRes.ok || !gRes.ok) return;

        const allNotifications = await nRes.json().catch(() => []);
        const allGroups = await gRes.json().catch(() => []);

        const dismissed = normalizeDismissed();
        const section = getSectionFromUser(loggedInUser);

        const myGroups = Array.isArray(allGroups)
          ? allGroups.filter((g) => Array.isArray(g.userIds) && g.userIds.includes(loggedInUser.id))
          : [];
        const myGroupIds = myGroups.map((g) => g.id);

        const relevant = (Array.isArray(allNotifications) ? allNotifications : [])
          .filter((note) => {
            try {
              const ts = new Date(note.timestamp);
              if (isNaN(ts)) return false;

              const key = ts.toISOString().split(".")[0] + "Z";
              if (dismissed.has(key)) return false;

              const recips = Array.isArray(note.recipients) ? note.recipients : [];
              const norm = (v) => String(v || "").trim().toLowerCase();
              const rn = recips.map(norm);

              const isAll = rn.includes("all") || rn.includes("*");

              // ✅ Role buckets (global truth)
              const rolesArr = Array.isArray(loggedInUser?.roles)
                ? loggedInUser.roles
                : loggedInUser?.role
                ? [loggedInUser.role]
                : [];
              const myRoles = rolesArr.map(norm);

              const isAdmin = myRoles.includes("admin");
              const isDriver = myRoles.includes("driver") || myRoles.includes("driver_limited");

              const adminBuckets = new Set(["admin", "admins", "admins:", "administrators", "administrator"]);
              const driverBuckets = new Set(["driver", "drivers", "driver_limited"]);

              const hitAdminBucket = rn.some((x) => adminBuckets.has(x));
              const hitDriverBucket = rn.some((x) => driverBuckets.has(x));

              return (
                isAll ||

                // Direct recipient targeting
                rn.includes(norm(loggedInUser.name)) ||
                rn.includes(norm(loggedInUser.id)) ||
                rn.includes(norm(section)) ||

                // Group targeting by group id
                recips.some((r) => myGroupIds.includes(r)) ||

                // ✅ Bucket targeting by role
                (isAdmin && hitAdminBucket) ||
                (isDriver && hitDriverBucket)
              );
            } catch {
              return false;
            }
          })
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // 📌 Update navbar unread badge
        try {
          localStorage.setItem("loBoard.unreadCount", String(relevant.length));
          window.dispatchEvent(new CustomEvent("loBoard:unread"));
        } catch {
          // ignore
        }

        // First successful load → DO NOT play sound / toast
        if (!state.bootstrapped) {
          state.bootstrapped = true;
          state.lastSeenMs = relevant[0] ? new Date(relevant[0].timestamp).getTime() : 0;
          return;
        }

        const newest = relevant[0];
        const newestMs = newest ? new Date(newest.timestamp).getTime() : 0;

        // No new notifications
        if (!newestMs || newestMs <= state.lastSeenMs) return;

        // Mark as seen first (prevents double-fire if toast() throws)
        state.lastSeenMs = newestMs;

        const toastEnabled =
          localStorage.getItem("notificationToastsEnabled") !== "false";
        const soundEnabled =
          localStorage.getItem("notificationSoundsEnabled") !== "false";

              // ✅ Single source of truth for alerts + dedupe
        fireGlobalAlert({
          title: newest?.title || "New notification",
          message: newest?.message || "",
          urgent: !!newest?.urgent,
          category: newest?.category || "admin",
          timestamp: newest?.timestamp,
        });
      } catch (err) {
        if (err?.name !== "AbortError") {
          console.warn("[App] Notification poll error:", err);
        }
      }
    };

    // Run immediately and then frequently (so you don’t have to “wait 2 minutes”)
    poll();
    const interval = setInterval(poll, 15000); // ✅ 15s

    const onVis = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVis);

    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(interval);
      controller.abort();
    };

    window.__loBoardNotifController = { userId: loggedInUser.id, cleanup };

    return () => {
      try {
        window.__loBoardNotifController?.cleanup?.();
      } catch {
        // ignore
      }
      window.__loBoardNotifController = null;
    };
  }, [
    loggedInUser?.id,
    loggedInUser?.name,
    loggedInUser?.description,
    loggedInUser?.section,
    toast,
  ]);

  // ✅ NEW: Heartbeat that stamps "lastOnline" for the logged-in user
  const onlineHeartbeatRef = useRef(null);

  useEffect(() => {
    // Clear any existing timer first
    if (onlineHeartbeatRef.current) {
      clearInterval(onlineHeartbeatRef.current);
      onlineHeartbeatRef.current = null;
    }

    if (!loggedInUser?.id) return;

    const ping = async () => {
      try {
        await fetch(`${API_BASE}/users/${loggedInUser.id}/last-online`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lastOnline: new Date().toISOString() }),
        });
      } catch {
        // Silent: network hiccups shouldn't spam console
      }
    };

    // Stamp immediately, then every 5 minutes
    ping();
    onlineHeartbeatRef.current = setInterval(ping, 5 * 60 * 1000);

    return () => {
      if (onlineHeartbeatRef.current) {
        clearInterval(onlineHeartbeatRef.current);
        onlineHeartbeatRef.current = null;
      }
    };
  }, [loggedInUser?.id]);

  // 📦 Changelog Dialog logic
  const [showChangelog, setShowChangelog] = useState(() => {
    const lastSeen = localStorage.getItem("lastSeenChangelog");
    return lastSeen !== "0.7.0";
  });

  const handleCloseChangelog = () => {
    localStorage.setItem("lastSeenChangelog", "0.7.0");
    setShowChangelog(false);
  };

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
              <HomeCarousel
                tickets={tickets}
                users={users}
                vehicles={vehicles}
                loggedInUser={loggedInUser}
                setTickets={setTickets}
              />
            }
          />
          <Route
            path="/operations"
            element={
              <OperationsPage
                users={users}
                setUsers={setUsers}
                tickets={tickets}
                loggedInUser={loggedInUser}
              />
            }
          />
                 <Route
            path="/profile"
            element={
              <MyProfile
                loggedInUser={effectiveUser}
                realLoggedInUser={loggedInUser} // safe extra prop (ignored if unused)
                adminViewAs={adminViewAs}       // safe extra prop (ignored if unused)
              />
            }
          />
          <Route
            path="/fleet"
            element={
              <FleetPage
                vehicles={vehicles}
                setVehicles={setVehicles}
                loggedInUser={loggedInUser}
                tickets={tickets}
              />
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
              ) : (
                <HomeCarousel
                  tickets={tickets}
                  users={users}
                  loggedInUser={loggedInUser}
                  setTickets={setTickets}
                />
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
            }
          />
          <Route
            path="/create"
            element={
              <TicketForm
                users={users}
                tickets={tickets}
                setTickets={setTickets}
                loggedInUser={loggedInUser}
                vehicles={vehicles}
              />
            }
          />
          <Route
            path="*"
            element={
              <HomeCarousel
                tickets={tickets}
                users={users}
                vehicles={vehicles}
                loggedInUser={loggedInUser}
                setTickets={setTickets}
              />
            }
          />
        </Routes>
      </div>

      {!hideLayout && <Footer />}
      {showChangelog && <ChangelogDialog open={true} onClose={handleCloseChangelog} />}

      {/* 🔔 Global admin toasts appear across the entire app */}
      <AdminGlobalToasts loggedInUser={loggedInUser} />

      <Toaster toastOptions={{ position: "top-center" }} />
    </>
  );
}



export default AppWrapper;
