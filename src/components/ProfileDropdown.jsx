import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, UserCircle2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import API_BASE from "@/api";

export default function ProfileDropdown({ loggedInUser, onLogout }) {
  const [open, setOpen] = useState(false);
  const [showDot, setShowDot] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("loggedInUser");
    if (onLogout) onLogout();
    navigate("/login");
  };

  useEffect(() => {
    const checkNotifications = async () => {
      if (!loggedInUser?.name) return;
      try {
        const res = await fetch(
          `${API_BASE}/notifications?user=${encodeURIComponent(loggedInUser.name)}`
        );
        const data = await res.json();
        const latest = data[0]?.timestamp;
        const lastSeen = localStorage.getItem("lastNotificationSeen");
        if (latest && latest !== lastSeen) {
          setShowDot(true);
        } else {
          setShowDot(false);
        }
      } catch (err) {
        console.error("Notification check failed", err);
      }
    };

    checkNotifications();
  }, [loggedInUser]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative flex items-center gap-2 px-2"
        >
          <div className="relative">
            <Avatar className="h-8 w-8">
              <AvatarFallback>
                {loggedInUser?.name?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>
            {showDot && (
              <span className="absolute top-0 right-0 h-2 w-2 bg-red-500 rounded-full border border-white" />
            )}
          </div>
          <span className="hidden md:inline text-sm font-medium">
            {loggedInUser?.name || "Profile"}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => navigate("/profile")}>
          <UserCircle2 className="w-4 h-4 mr-2" />
          My Profile
        </DropdownMenuItem>

        {/* <DropdownMenuItem onClick={() => navigate("/achievements")}>
          <Trophy className="w-4 h-4 mr-2" />
          Achievements
        </DropdownMenuItem> */}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
