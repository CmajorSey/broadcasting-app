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

    // Fire all initial loads
    loadUsers();
    loadTickets();
    loadVehicles();
  }, []);


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
    const category = String(note.category || "admin").toLowerCase();

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

    // ✅ Refresh-safe guard second (prevents re-toast/re-sound after reload)
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
      toast({
        title: note.title || "New notification",
        description: note.message || "",
        variant: urgent ? "destructive" : undefined,
      });
    }

    if (soundEnabled) {
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
    try {
      if (Number.isFinite(noteTs) && noteTs > 0) {
        const next = Math.max(lastSeen, noteTs);
        localStorage.setItem(LAST_SEEN_KEY, String(next));
      }
    } catch {
      // ignore
    }
  },
  [toast]
);

  // ✅ NEW: Global notifications wiring (POLL + PUSH) lives here
  useEffect(() => {
    const myName = String(loggedInUser?.name || "").trim();
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
        note: "No loggedInUser.name – global alerts disabled",
      });
      return;
    }

    let cancelled = false;
    let timer = null;

    const syncUnread = (visibleList) => {
      try {
        const n = Array.isArray(visibleList) ? visibleList.length : 0;
        localStorage.setItem("loBoard.unreadCount", String(n));
        window.dispatchEvent(new CustomEvent("loBoard:unread"));
      } catch {
        // ignore
      }
    };

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/notifications`);
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

        const mine = list.filter(
          (n) => Array.isArray(n?.recipients) && n.recipients.includes(myName)
        );

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

        syncUnread(visible);

        for (const n of visible) {
          if (cancelled) break;
          await fireGlobalAlert({
            ...n,
            __source: "poll",
            __recipientMatch: true,
          });
        }

        setDebugBanner((prev) => ({
          ...(prev || {}),
          at: new Date().toISOString(),
          source: "poll",
          note: `OK (${visible.length} visible)`,
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

    // 🔔 PUSH listener (foreground messages)
    const unsubscribe = onMessage((payload) => {
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

        const matches = recipients.length === 0 ? true : recipients.includes(myName);

        fireGlobalAlert({
          title,
          message,
          category,
          urgent,
          timestamp: payload?.data?.timestamp || new Date().toISOString(),
          recipients,
          __source: "push",
          __recipientMatch: matches,
        });
      } catch {
        // ignore
      }
    });

    // Optional: ensure permission/token setup (safe to call)
    try {
      requestPermission(loggedInUser);
    } catch {
      // ignore
    }

    poll();
    timer = setInterval(poll, 15000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [loggedInUser?.name, fireGlobalAlert]);

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
      {showChangelog && (
        <ChangelogDialog open={true} onClose={handleCloseChangelog} />
      )}

      <Toaster toastOptions={{ position: "top-center" }} />
    </>
  );
}



export default AppWrapper;
