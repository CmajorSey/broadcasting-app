import { Link, useNavigate } from "react-router-dom";
import {
  Home,
  Users,
  PanelLeft,
  PlusCircle,
  Truck,
  FileText,
  LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Navbar({ loggedInUser, setLoggedInUser, users }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("rememberedUser");
    setLoggedInUser(null);
    navigate("/login");
  };

  const handleRoleSwitch = (name) => {
    const user = users.find((u) => u.name === name);
    if (!user) return;

    localStorage.setItem("loggedInUser", JSON.stringify(user));
    window.location.reload();
  };

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
  {loggedInUser?.roles?.includes("admin") &&
    window.location.hostname === "localhost" &&
    users &&
    users.length > 0 && (
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs opacity-70">Switch User:</span>
        {users.map((u) => (
          <Button
            key={u.id}
            size="xs"
            variant="secondary"
            className="text-xs"
            onClick={() => handleRoleSwitch(u.name)}
          >
            {u.name}
          </Button>
        ))}
      </div>
    )}

  {loggedInUser && (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleLogout}
      className="flex items-center gap-2"
    >
      <span className="text-xs">{loggedInUser.name.split(" ")[0]}</span>
      <LogOut size={16} />
      <span className="text-xs">Logout</span>
    </Button>
  )}
</div>
    </nav>
  );
}
