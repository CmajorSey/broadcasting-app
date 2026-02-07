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
  const [unreadCount, setUnreadCount] = useState(0);
  const navigate = useNavigate();

  const handleLogout = () => {
  if (onLogout) onLogout();
};

    useEffect(() => {
    // ✅ Source of truth: global unread count stamped by App poller / MyProfile inbox
    const readUnread = () => {
      const raw = localStorage.getItem("loBoard.unreadCount");
      const n = Number(raw);
      setUnreadCount(Number.isFinite(n) && n > 0 ? n : 0);
    };

    readUnread();

    const onStorage = (e) => {
      if (e.key === "loBoard.unreadCount") readUnread();
    };

    const onUnreadEvent = () => readUnread();

    window.addEventListener("storage", onStorage);
    window.addEventListener("loBoard:unread", onUnreadEvent);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("loBoard:unread", onUnreadEvent);
    };
  }, [loggedInUser?.id, loggedInUser?.name]);

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
                     {unreadCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 border border-white text-white text-[11px] font-bold flex items-center justify-center"
                title={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
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
