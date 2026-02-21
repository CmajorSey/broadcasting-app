import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  Home,
  Users,
  User,
  Bell,
  PanelLeft,
  PlusCircle,
  Truck,
  FileText,
  Newspaper,
  Trophy,
  Clapperboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import ProfileDropdown from "@/components/ProfileDropdown";
import API_BASE from "@/api";

/* ===========================
   🧩 Mobile side menu (Sheet)
   =========================== */
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const CLOCK_STORAGE_KEY = "navbar.clock.format"; // "12h" | "24h"

/* ===========================
   🔒 Admin detection (Navbar)
   =========================== */
function isAdminUser(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const role = String(user?.role || "").toLowerCase();
  return roles.includes("admin") || role === "admin";
}

/* ===========================
   🧪 View-As resolver (Navbar)
   - If admin is "viewing as" someone, the app should behave like that user
   - This is what controls Admin link visibility + access expectations
   =========================== */
function readAdminViewAsFromStorage() {
  try {
    const raw = localStorage.getItem("adminViewAs");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export default function Navbar({
  loggedInUser,
  setLoggedInUser,
  users,
  adminViewAs = null,
  setAdminViewAs = () => {},
  effectiveUser = null,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  /* ===========================
     📱 Mobile menu open state
     =========================== */
  const [mobileOpen, setMobileOpen] = useState(false);

  /* ===========================
     👤 Mobile profile dropdown open
     - Opens My Profile + Logout menu in the left drawer
     =========================== */
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);

  // ✅ Auto-clear unread badge when user opens My Profile
  useEffect(() => {
    const path = location?.pathname || "";

    // Add any aliases you may use for the profile route here
    const isProfileRoute =
      path === "/profile" || path === "/my-profile" || path.startsWith("/profile/");

    if (!isProfileRoute) return;

    // Only write when needed (avoid extra events)
    const current = Number(localStorage.getItem("loBoard.unreadCount") || "0");
    if (!Number.isFinite(current) || current <= 0) return;

    try {
      localStorage.setItem("loBoard.unreadCount", "0");
      window.dispatchEvent(new CustomEvent("loBoard:unread"));
    } catch {
      // ignore
    }
  }, [location?.pathname]);

  // Close mobile menu on route change (nice UX)
  useEffect(() => {
    setMobileOpen(false);
    setMobileProfileOpen(false);
  }, [location?.pathname]);

  // Also close the profile dropdown if the sheet is closed manually
  useEffect(() => {
    if (!mobileOpen) setMobileProfileOpen(false);
  }, [mobileOpen]);

  const handleLogout = () => {

    // 🔴 clear unread badge
    try {
      localStorage.setItem("loBoard.unreadCount", "0");
      window.dispatchEvent(new CustomEvent("loBoard:unread"));
    } catch {
      // ignore
    }

    setLoggedInUser(null);
    navigate("/login");
  };

  // ✅ storage listener: keep clock format in sync (View As is controlled by App state now)
  useEffect(() => {
    const handleStorageChange = (e) => {
      const key = e?.key;

      // If storage event is generic (manual dispatch) OR clock key changed, refresh clock format
      if (!key || key === CLOCK_STORAGE_KEY) {
        setIs12h(localStorage.getItem(CLOCK_STORAGE_KEY) === "12h");
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // 🔴 Unread notifications badge (Inbox-driven)
  // Goal: badge reflects how many items are actually in the user's inbox.
  // Fallback: if inbox is not stamped into localStorage yet, use loBoard.unreadCount.
  const readInboxCountFromStorage = () => {
    const tryKeys = [
      "loBoard.inbox", // ✅ preferred (array of inbox items)
      "loBoard.notificationsInbox", // ✅ alternate (if you used a different key)
      "loBoard.inboxNotifications", // ✅ alternate (if you used a different key)
    ];

    for (const k of tryKeys) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.length;
      } catch {
        // ignore bad json
      }
    }

    // Fallback: controller-based count (may include non-inbox events)
    const n = Number(localStorage.getItem("loBoard.unreadCount") || "0");
    return Number.isFinite(n) ? n : 0;
  };

  const [unreadCount, setUnreadCount] = useState(() => readInboxCountFromStorage());

  useEffect(() => {
    const refreshUnread = () => {
      setUnreadCount(readInboxCountFromStorage());
    };

    // ✅ When inbox changes (MyProfile clears, inbox refresh, etc.)
    const onInbox = () => refreshUnread();

    // ✅ Legacy/controller signal (still supported, but we compute from inbox first)
    const onUnread = () => refreshUnread();

    // ✅ Also update when storage changes (other tabs / manual updates)
    const onStorage = (e) => {
      const key = e?.key;

      // If generic storage event OR one of our keys changed, refresh
      const watched =
        !key ||
        key === "loBoard.unreadCount" ||
        key === "loBoard.inbox" ||
        key === "loBoard.notificationsInbox" ||
        key === "loBoard.inboxNotifications";

      if (watched) refreshUnread();
    };

    window.addEventListener("loBoard:inbox", onInbox);
    window.addEventListener("loBoard:unread", onUnread);
    window.addEventListener("storage", onStorage);

    // bootstrap once
    refreshUnread();

    return () => {
      window.removeEventListener("loBoard:inbox", onInbox);
      window.removeEventListener("loBoard:unread", onUnread);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // --- ⏰ NAVBAR CLOCK (GMT+4, Seychelles) with seconds + persistence ---
  const [now, setNow] = useState(() => new Date());

  const initial12h =
    loggedInUser?.preferredTimeFormat === "12h" ||
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
    } catch {
      /* ignore and keep local */
    }
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

  /* ===========================
     ✅ The “acting user” for UI
     - If admin is viewing-as, hide admin UI and links
     - Regular users behave normally
     =========================== */
  const storageViewAs = typeof window !== "undefined" ? readAdminViewAsFromStorage() : null;
  const actingUser = effectiveUser || adminViewAs || storageViewAs || loggedInUser;

  /* ===========================
     🔒 Admin link visibility rule
     - Based on actingUser (View As)
     =========================== */
  const canSeeAdminUI = isAdminUser(actingUser);

  /* ===========================
     🧭 Clock UI
     =========================== */
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

  /* ===========================
     🧩 Nav Items (single source)
     - Reused for Desktop row + Mobile sheet
     =========================== */
  const navItems = [
    { to: "/", label: "Home", Icon: Home, show: true },
    { to: "/create", label: "Create Request", Icon: PlusCircle, show: true },
    { to: "/tickets", label: "Request Forms", Icon: FileText, show: true },
    { to: "/fleet", label: "Fleet", Icon: Truck, show: true },
    { to: "/operations", label: "Operations", Icon: PanelLeft, show: true },
    { to: "/newsroom", label: "Newsroom", Icon: Newspaper, show: !!loggedInUser },
    { to: "/sports", label: "Sports", Icon: Trophy, show: !!loggedInUser },
    { to: "/production", label: "Production", Icon: Clapperboard, show: !!loggedInUser },
    { to: "/admin", label: "Admin", Icon: Users, show: !!canSeeAdminUI },
  ].filter((x) => x.show);

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
            // ✅ App state drives the UI/fetches
            setAdminViewAs(u);

            // ✅ Keep your existing local testing workflow working too
            try {
              localStorage.setItem("adminViewAs", JSON.stringify(u));
              // best-effort "storage" signal (App also polls adminViewAs)
              window.dispatchEvent(new Event("storage"));
            } catch {
              // ignore
            }
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
          // ✅ App state drives the UI/fetches
          setAdminViewAs(null);

          // ✅ Keep dev workflow consistent
          try {
            localStorage.removeItem("adminViewAs");
            window.dispatchEvent(new Event("storage"));
          } catch {
            // ignore
          }
        }}
      >
        Reset View
      </Button>
    </div>
  );

  /* ===========================
     🖥️ Desktop menus (under clock)
     =========================== */
  const DesktopMenuRow = (
    <div className="hidden md:block">
      <div className="flex justify-center">
        <div className="flex items-center gap-5 whitespace-nowrap overflow-x-auto px-2 py-2">
          {navItems.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-2 hover:underline text-sm"
              title={label}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );

  /* ===========================
     📱 Mobile side menu content
     - Profile at top (inside)
     =========================== */
  const MobileSheet = (
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetContent side="left" className="w-[280px] sm:w-[320px]">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-2">
            <span className="font-semibold">Menu</span>
            {/* Keep clock visible inside the menu too */}
            {ClockBox}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* ===========================
             👤 Profile (top of menu)
             =========================== */}
                    {/* ===========================
             👤 Profile (top of menu)
             - Icon toggles ProfileDropdown (My Profile + Logout)
             - Badge stays on icon
             =========================== */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setMobileProfileOpen((v) => !v)}
              className="w-full relative flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition"
              title="Profile"
              aria-label="Profile"
            >
              <div className="relative">
                <User size={20} />

                {unreadCount > 0 && (
                  <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center leading-none">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
            </button>

            {/* Dropdown panel inside the menu */}
            {mobileProfileOpen && loggedInUser && (
              <div className="ml-3 pl-3 border-l border-white/20">
                <ProfileDropdown loggedInUser={loggedInUser} onLogout={handleLogout} />
              </div>
            )}
          </div>

          {/* ===========================
             🔗 Nav links (mobile list)
             =========================== */}
          <div className="space-y-1">
            {navItems.map(({ to, label, Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition"
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={18} />
                <span className="text-sm">{label}</span>
              </Link>
            ))}
          </div>

          {/* ===========================
             🧪 Local Admin View panel (mobile too)
             =========================== */}
          {AdminDevPanel && (
            <div className="pt-3 border-t">
              {AdminDevPanel}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <nav className="bg-blue-800 text-white px-4 py-3 shadow-md">
      {/* ===========================
         📱 Mobile header
         - Left: hamburger
         - Center: clock (kept visible)
         - Right: (empty, because profile lives in menu)
         =========================== */}
      <div className="md:hidden flex items-center justify-between gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 px-2 py-2 rounded-md hover:bg-white/10 transition"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          title="Menu"
        >
          <PanelLeft size={20} />
        </button>

        <div className="flex-1 flex justify-center">{ClockBox}</div>

        {/* spacer to balance layout */}
        <div className="w-[44px]" />
      </div>

      {/* Mobile Sheet */}
      {MobileSheet}

      {/* ===========================
         🖥️ Desktop layout
         - Row 1: clock centered, profile right
         - Row 2: all menus under the clock in one line
         - Local Admin View keeps the dev controls visible (still View-As aware)
         =========================== */}
      <div className="hidden md:block">
        {isLocalAdminView ? (
          <div className="space-y-2">
            {/* Row 1 (dev): admin panel + clock + profile */}
            <div className="grid grid-cols-3 items-center">
              <div className="flex items-center">{AdminDevPanel}</div>
              <div className="flex justify-center">{ClockBox}</div>
              <div className="flex justify-end">
                {loggedInUser && (
                  <ProfileDropdown loggedInUser={loggedInUser} onLogout={handleLogout} />
                )}
              </div>
            </div>

            {/* Row 2: menus under clock */}
            {DesktopMenuRow}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Row 1: clock center, profile right */}
            <div className="grid grid-cols-3 items-center">
              <div />
              <div className="flex justify-center">{ClockBox}</div>
              <div className="flex justify-end">
                {loggedInUser && (
                  <ProfileDropdown loggedInUser={loggedInUser} onLogout={handleLogout} />
                )}
              </div>
            </div>

            {/* Row 2: menus under clock */}
            {DesktopMenuRow}
          </div>
        )}
      </div>
    </nav>
  );
}