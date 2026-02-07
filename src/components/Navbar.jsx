import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Home,
  Users,
  PanelLeft,
  PlusCircle,
  Truck,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ProfileDropdown from "@/components/ProfileDropdown";
import API_BASE from "@/api";

const CLOCK_STORAGE_KEY = "navbar.clock.format"; // "12h" | "24h"

export default function Navbar({ loggedInUser, setLoggedInUser, users }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("rememberedUser");
    localStorage.removeItem("adminViewAs");
    setLoggedInUser(null);
    navigate("/login");
  };

  const [adminViewAs, setAdminViewAs] = useState(() => {
    const stored = localStorage.getItem("adminViewAs");
    return stored ? JSON.parse(stored) : null;
  });

useEffect(() => {
  const handleStorageChange = (e) => {
  const key = e?.key;

  if (!key || key === "adminViewAs") {
    const updated = localStorage.getItem("adminViewAs");
    setAdminViewAs(updated ? JSON.parse(updated) : null);
  }

  if (!key || key === CLOCK_STORAGE_KEY) {
    setIs12h(localStorage.getItem(CLOCK_STORAGE_KEY) === "12h");
  }
};
  window.addEventListener("storage", handleStorageChange);
  return () => window.removeEventListener("storage", handleStorageChange);
}, []);


  // --- ⏰ NAVBAR CLOCK (GMT+4, Seychelles) with seconds + persistence ---
  const [now, setNow] = useState(() => new Date());

  const initial12h =
    (loggedInUser?.preferredTimeFormat === "12h") ||
    (loggedInUser?.preferredTimeFormat == null &&
      localStorage.getItem(CLOCK_STORAGE_KEY) === "12h");

  const [is12h, setIs12h] = useState(initial12h);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (loggedInUser?.preferredTimeFormat) {
      setIs12h(loggedInUser.preferredTimeFormat === "12h");
      localStorage.setItem(CLOCK_STORAGE_KEY, loggedInUser.preferredTimeFormat);
    }
  }, [loggedInUser?.preferredTimeFormat]);

  const timeString = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: is12h,
    timeZone: "Indian/Mahe",
  });

  const savePrefToServer = async (nextFormat) => {
    try {
      if (!loggedInUser?.id) return;
      let res = await fetch(`${API_BASE}/user-prefs/${encodeURIComponent(loggedInUser.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredTimeFormat: nextFormat }),
      });
      if (!res.ok) {
        res = await fetch(`${API_BASE}/users/${encodeURIComponent(loggedInUser.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferredTimeFormat: nextFormat }),
        });
      }
      if (res.ok) {
        const updated = { ...loggedInUser, preferredTimeFormat: nextFormat };
        localStorage.setItem("loggedInUser", JSON.stringify(updated));
      }
    } catch {/* ignore and keep local */}
  };

  const toggleFormat = () => {
    const next = !is12h;
    setIs12h(next);
    const nextFormat = next ? "12h" : "24h";
    localStorage.setItem(CLOCK_STORAGE_KEY, nextFormat);
    savePrefToServer(nextFormat);
  };
  // ----------------------------------------------------------------------

  const userKey = (u, idx) => String(u.id ?? `${u.name ?? "user"}-${idx}`);

  // 🔎 Detect "local admin view" mode (where we list users + view-as buttons)
  const isLocalAdminView =
    loggedInUser?.name === "Admin" &&
    typeof window !== "undefined" &&
    window.location.hostname.includes("localhost") &&
    Array.isArray(users) &&
    users.length > 0;

  // Reusable pieces to keep JSX tidy
  const LeftLinks = (
    <div className="flex flex-wrap items-center gap-4 md:justify-start">
      <Link to="/" className="font-semibold flex items-center gap-1 hover:underline">
        <Home size={18} />
        Home
      </Link>

      <Link to="/tickets" className="flex items-center gap-1 hover:underline">
        <FileText size={18} />
        Request Forms
      </Link>

      <Link to="/fleet" className="flex items-center gap-1 hover:underline">
        <Truck size={18} />
        Fleet
      </Link>

      <Link to="/operations" className="flex items-center gap-1 hover:underline">
        <PanelLeft size={18} />
        Operations
      </Link>

      <Link to="/create" className="flex items-center gap-1 hover:underline">
        <PlusCircle size={18} />
        Create Request
      </Link>

      {loggedInUser?.roles?.includes("admin") && (
        <Link to="/admin" className="flex items-center gap-1 hover:underline">
          <Users size={18} />
          Admin
        </Link>
      )}
    </div>
  );

  const AdminDevPanel = isLocalAdminView && (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs opacity-70">View as:</span>
      {users.map((u, idx) => (
        <Button
          key={userKey(u, idx)}
          size="xs"
          variant="secondary"
          className={`text-xs ${u.name === adminViewAs?.name ? "bg-primary text-white" : ""}`}
          onClick={() => {
            localStorage.setItem("adminViewAs", JSON.stringify(u));
            window.dispatchEvent(new Event("storage"));
            setAdminViewAs(u);
          }}
        >
          {u.name}
        </Button>
      ))}
      <Button
        size="xs"
        variant="ghost"
        className="text-[10px] ml-2"
        onClick={() => {
          localStorage.removeItem("adminViewAs");
          window.dispatchEvent(new Event("storage"));
          setAdminViewAs(null);
        }}
      >
        Reset View
      </Button>
    </div>
  );

  const ClockBox = (
    <div
      className="font-mono text-sm bg-white/10 px-3 py-1 rounded-md tracking-widest select-none cursor-pointer hover:bg-white/20 transition"
      title={`Click to toggle ${is12h ? "24h" : "12h"} mode`}
      aria-label="Current Seychelles time"
      onClick={toggleFormat}
    >
      {timeString}
    </div>
  );

  return (
    <nav className="bg-blue-800 text-white px-4 py-3 shadow-md">
      {isLocalAdminView ? (
        // 🧭 Local Admin View: old flex layout with clock on the right
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          {/* Left cluster */}
          {LeftLinks}

          {/* Right cluster: admin view-as, clock, profile */}
          <div className="flex items-center gap-4 flex-wrap justify-start md:justify-end">
            {AdminDevPanel}
            {ClockBox}
            {loggedInUser && (
              <ProfileDropdown loggedInUser={loggedInUser} onLogout={handleLogout} />
            )}
          </div>
        </div>
      ) : (
        // 👥 Everyone else: 3-column grid with centered clock
        <div className="grid grid-cols-1 md:grid-cols-3 md:items-center gap-2">
          {/* Left links */}
          {LeftLinks}

          {/* Centered clock */}
          <div className="flex justify-center order-3 md:order-none">
            {ClockBox}
          </div>

          {/* Right: (no admin panel here), just profile */}
          <div className="flex items-center gap-4 flex-wrap justify-start md:justify-end">
            {loggedInUser && (
              <ProfileDropdown loggedInUser={loggedInUser} onLogout={handleLogout} />
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
