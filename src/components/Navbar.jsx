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
    const handleStorageChange = () => {
      const updated = localStorage.getItem("adminViewAs");
      setAdminViewAs(updated ? JSON.parse(updated) : null);
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return (
    <nav className="bg-blue-800 text-white px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2 shadow-md">
      <div className="flex flex-wrap items-center gap-4">
        <Link to="/" className="font-semibold flex items-center gap-1 hover:underline">
          <Home size={18} />
          Home
        </Link>

        <Link to="/tickets" className="flex items-center gap-1 hover:underline">
          <FileText size={18} />
          Tickets
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
          Create Ticket
        </Link>

        {loggedInUser?.roles?.includes("admin") && (
          <Link to="/admin" className="flex items-center gap-1 hover:underline">
            <Users size={18} />
            Admin
          </Link>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-wrap">
        {loggedInUser?.name === "Admin" &&
          window.location.hostname.includes("localhost") &&
          users?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs opacity-70">View as:</span>
              {users.map((u) => (
                <Button
                  key={u.id}
                  size="xs"
                  variant="secondary"
                  className={`text-xs ${
                    u.name === adminViewAs?.name ? "bg-primary text-white" : ""
                  }`}
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
          )}

        {loggedInUser && (
          <ProfileDropdown loggedInUser={loggedInUser} onLogout={handleLogout} />
        )}
      </div>
    </nav>
  );
}
