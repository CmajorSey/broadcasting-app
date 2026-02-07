import { useState, useEffect, useRef } from "react";
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
import { playSoundFor, isSoundEnabled } from "@/lib/soundRouter";


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
  const hideLayout = location.pathname === "/login";
  const { toast } = useToast();

  // 🔊 Small safe beep for notification sound (no asset needed)
  const playBeep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.03;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close?.();
      }, 140);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!loggedInUser && location.pathname !== "/login" && location.pathname !== "/set-password") {
      navigate("/login");
    }
  }, [loggedInUser, location]);

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
    const tryPlayNotifySound = () => {
      try {
        // respect toggle (default = enabled unless explicitly "false")
        const enabled = localStorage.getItem("notificationSoundsEnabled");
        if (enabled === "false") return;

        const a = new Audio("/sounds/lo_notify_new.mp3");
        a.volume = 1;
        const p = a.play();
        if (p && typeof p.catch === "function") {
          p.catch((e) => console.warn("[sound] play blocked:", e));
        }
      } catch (e) {
        console.warn("[sound] play failed:", e);
      }
    };

    const unsubscribe = onMessage((payload) => {
      console.log("Foreground notification received:", payload);

      const { title, body } = payload?.notification || {};

      if (title && body) {
        // 🔊 sound first (best effort)
        tryPlayNotifySound();

        toast({
          title,
          description: body,
        });
      }
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [toast]);

  // Migrate users with legacy 'role' field
  useEffect(() => {
    const migrated = users.map((user) => {
      if (!user.roles && user.role) {
        return { ...user, roles: [user.role], role: undefined };
      }
      return user;
    });
    const needsMigration = migrated.some((u, i) => users[i].role);
    if (needsMigration) {
      setUsers(migrated);
    }
  }, []);
  const firedTestPushOnceRef = useRef(false);

    useEffect(() => {
    if (firedTestPushOnceRef.current) return; // avoid double-fire in dev
    firedTestPushOnceRef.current = true;

    const testPush = async () => {
      // ⚠️ Keep your test token here OR wire in the freshly obtained token.
      const token = "cZuEcPz4jfZHlZlJOuFhwm:APA91bGTDvUBe1VVEhu8ZlUWdFkTWHYFBzwa2G8bFWhwSDtrrz0INZSSVkUYrcfSXZps3MamCkp9ihXaiuBUXmu6Bx1VlCmqz2FnhWqpcATBbotYW1SNnA4";

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
  // 🔔 Global notifications poller (ALL users)
  // - updates navbar unread badge everywhere
  // - optional toast + sound (respects user settings)
  // - avoids StrictMode double-run with a singleton guard
  // ============================================================
  useEffect(() => {
    if (!loggedInUser?.id || !loggedInUser?.name) return;

    // 🚦 Singleton guard
    if (window.__loBoardUserNotifPoller) return;

    const controller = new AbortController();
    const state = {
      lastLatestISO: null,
      bootstrapped: false, // don't beep/toast on first load
    };

    const getSectionFromUser = (u) => {
      if (!u) return "N/A";
      const name = u.name || "";
      const desc = u.description?.toLowerCase() || "";

      if (["clive camille", "jennifer arnephy", "gilmer philoe"].includes(name.toLowerCase())) {
        return "Admin";
      } else if (desc.includes("sports journalist")) {
        return "Sports Section";
      } else if (desc.includes("journalist")) {
        return "Newsroom";
      } else if (/cam ?op|camera ?operator|operations/i.test(desc)) {
        return "Operations";
      } else if (desc.includes("producer") || desc.includes("production")) {
        return "Production";
      }

      return u.section || "Unspecified";
    };

    const normalizeDismissedSeconds = () => {
      try {
        const raw = JSON.parse(localStorage.getItem("dismissedNotifications") || "[]") || [];
        const out = [];
        for (const t of raw) {
          try {
            const d = new Date(t);
            if (!isNaN(d)) out.push(d.toISOString().split(".")[0]);
          } catch {
            // ignore
          }
        }
        return new Set(out);
      } catch {
        return new Set();
      }
    };

    const computeRelevant = (allNotifications, allGroups) => {
      const userName = loggedInUser.name;
      const section = getSectionFromUser(loggedInUser);

      const groups = Array.isArray(allGroups) ? allGroups : [];
      const mine = groups.filter((g) => Array.isArray(g.userIds) && g.userIds.includes(loggedInUser.id));
      const myGroupIds = mine.map((g) => g.id);

      const dismissed = normalizeDismissedSeconds();

      const list = Array.isArray(allNotifications) ? allNotifications : [];
      const relevant = list.filter((note) => {
        try {
          const noteDate = new Date(note.timestamp);
          if (isNaN(noteDate)) return false;
          const noteTime = noteDate.toISOString().split(".")[0];

          const recips = Array.isArray(note?.recipients) ? note.recipients : [];
          const match =
            recips.includes(userName) ||
            recips.includes(section) ||
            recips.some((r) => myGroupIds.includes(r));

          return match && !dismissed.has(noteTime);
        } catch {
          return false;
        }
      });

      relevant.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return relevant;
    };

    const stampUnread = (count) => {
      try {
        localStorage.setItem("loBoard.unreadCount", String(count));
        window.dispatchEvent(new CustomEvent("loBoard:unread"));
      } catch {
        // ignore
      }
    };

    const poll = async () => {
      if (document.hidden) return;

      try {
        const [nRes, gRes] = await Promise.all([
          fetch(`${API_BASE}/notifications`, { signal: controller.signal }),
          fetch(`${API_BASE}/notification-groups`, { signal: controller.signal }),
        ]);

        if (!nRes.ok || !gRes.ok) return;

        const [allNotifications, allGroups] = await Promise.all([
          nRes.json().catch(() => []),
          gRes.json().catch(() => []),
        ]);

        const relevant = computeRelevant(allNotifications, allGroups);
        stampUnread(relevant.length);

        const latestISO = relevant[0]?.timestamp || null;

        // Respect prefs
        const toastPref = localStorage.getItem("notificationToastsEnabled");
        const toastEnabled = toastPref !== "false";
        const soundPref = localStorage.getItem("notificationSoundsEnabled");
        const soundEnabled = soundPref !== "false";

        // On first successful poll, do not toast/beep (bootstrap)
        if (!state.bootstrapped) {
          state.bootstrapped = true;
          state.lastLatestISO = latestISO;
          return;
        }

        // Only act if newest changed
        if (latestISO && latestISO !== state.lastLatestISO) {
          state.lastLatestISO = latestISO;

          if (toastEnabled) {
            toast({ title: relevant[0]?.title, description: relevant[0]?.message });
          }
          if (soundEnabled) {
            playBeep();
          }

          // Keep compatibility with your existing marker
          localStorage.setItem("lastNotificationSeen", latestISO);
        }
      } catch (e) {
        if (e?.name !== "AbortError") {
          // silent-ish
          console.warn("[App] notifications poll error:", e);
        }
      }
    };

    poll();
    const id = setInterval(poll, 30000);
    window.__loBoardUserNotifPoller = { id, controller };

    const onVis = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (window.__loBoardUserNotifPoller?.id === id) {
        clearInterval(id);
        controller.abort();
        window.__loBoardUserNotifPoller = null;
      }
    };
  }, [loggedInUser?.id, loggedInUser?.name, loggedInUser?.description, loggedInUser?.section, toast]);

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
            element={<MyProfile loggedInUser={loggedInUser} />}
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
