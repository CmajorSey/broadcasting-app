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
  const unsubscribe = onMessage((payload) => {
    console.log("Foreground notification received:", payload);

    const { title, body } = payload?.notification || {};

    if (title && body) {
      toast({
        title,
        description: body,
      });
    }
  });

  return () => {
    if (typeof unsubscribe === "function") unsubscribe();
  };
}, []);

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



  // 📦 Changelog Dialog logic
  const [showChangelog, setShowChangelog] = useState(() => {
    const lastSeen = localStorage.getItem("lastSeenChangelog");
    return lastSeen !== "0.6.5";
  });

  const handleCloseChangelog = () => {
    localStorage.setItem("lastSeenChangelog", "0.6.5");
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
