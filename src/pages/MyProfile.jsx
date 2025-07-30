import { useEffect, useState } from "react";
import API_BASE from "@/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function MyProfile() {
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [suggestion, setSuggestion] = useState("");
  const [toastEnabled, setToastEnabled] = useState(true);
  const { toast } = useToast();
    const getSectionFromUser = (userObj) => {
    const name = userObj.name || "";
    const desc = userObj.description?.toLowerCase() || "";

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

    return userObj.section || "Unspecified";
  };


  // ✅ Load user and notifications
useEffect(() => {
  const override = localStorage.getItem("adminViewAs");
  const fallback = localStorage.getItem("loggedInUser");
  const parsed = override || fallback;
  const parsedUser = parsed ? JSON.parse(parsed) : null;

  const toastPref = localStorage.getItem("notificationToastsEnabled");
  setToastEnabled(toastPref !== "false");

  if (!parsedUser) return;

  setUser(parsedUser);

 const rawDismissed = JSON.parse(localStorage.getItem("dismissedNotifications") || "[]") || [];

const hiddenTimestamps = rawDismissed.reduce((acc, t) => {
  try {
    if (!t) return acc;
    const date = new Date(t);
    if (isNaN(date)) {
      console.warn("Skipping invalid timestamp in localStorage:", t);
      return acc;
    }
    acc.push(date.toISOString().split(".")[0]);
  } catch (err) {
    console.error("Error processing dismissed timestamp:", t, err);
  }
  return acc;
}, []);



Promise.all([
  fetch(`${API_BASE}/notifications`).then((res) => res.json()), // 🔄 removed ?user=...
  fetch(`${API_BASE}/notification-groups`).then((res) => res.json()),
])
  .then(([allNotifications, allGroups]) => {
    const userName = parsedUser.name;
    const section = getSectionFromUser(parsedUser);
    const userGroups = allGroups.filter((group) =>
      group.userIds.includes(parsedUser.id)
    );
    const groupIds = userGroups.map((g) => g.id);

    const relevant = allNotifications.filter((note) => {
      try {
        const noteDate = new Date(note.timestamp);
        if (isNaN(noteDate)) {
          console.warn("Skipping invalid notification timestamp:", note.timestamp);
          return false;
        }
        const noteTime = noteDate.toISOString().split(".")[0];

        return (
          (note.recipients.includes(userName) ||
            note.recipients.includes(section) ||
            note.recipients.some((r) => groupIds.includes(r))) &&
          !hiddenTimestamps.includes(noteTime)
        );
      } catch (err) {
        console.error("Failed to process note:", note, err);
        return false;
      }
    });



      // Sort newest first
      relevant.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      setNotifications(relevant);

      const lastSeen = localStorage.getItem("lastNotificationSeen");
      const latest = relevant[0]?.timestamp;
      if (toastEnabled && latest && latest !== lastSeen) {
        toast({
          title: relevant[0].title,
          description: relevant[0].message,
        });
        localStorage.setItem("lastNotificationSeen", latest);
      }
    })
    .catch((err) => console.error("Failed to fetch notifications or groups", err));
}, []); // 👈 removed toastEnabled from dependencies to avoid re-trigger


  // ✅ Enrich user with leave/off balances
  useEffect(() => {
    if (!user?.name) return;

    fetch(`${API_BASE}/users`)
      .then((res) => res.json())
      .then((allUsers) => {
        const fullUser = allUsers.find((u) => u.name === user.name);
        if (fullUser && JSON.stringify(fullUser) !== JSON.stringify(user)) {
          setUser(fullUser);
        }
      })
      .catch((err) => console.error("Failed to fetch user balances", err));
  }, [user?.name]);

    const handleDismiss = async (timestamp) => {
  const baseTimestamp = new Date(timestamp).toISOString().split(".")[0];

  // Optimistically update UI
  const updatedDismissed = [...new Set([...(JSON.parse(localStorage.getItem("dismissedNotifications") || "[]")), baseTimestamp])];
  localStorage.setItem("dismissedNotifications", JSON.stringify(updatedDismissed));

  setNotifications((prev) =>
    prev.filter((n) => {
      try {
        return new Date(n.timestamp).toISOString().split(".")[0] !== baseTimestamp;
      } catch {
        return true; // Keep it if broken
      }
    })
  );

  // Attempt to delete from backend
  try {
    const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(baseTimestamp)}`, {
      method: "DELETE",
    });

    if (!res.ok) throw new Error("Failed to delete notification");
  } catch (err) {
    console.error("Failed to delete notification from backend:", err);
  }
};

const handleSuggestionSubmit = async () => {
  if (!suggestion.trim()) return;

  const payload = {
    name: user?.name || "Anonymous",
    message: suggestion.trim(),
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${API_BASE}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("Failed to submit suggestion");

    setSuggestion("");
    toast({ title: "✅ Suggestion sent!" });
  } catch (err) {
    console.error("Error submitting suggestion:", err);
    toast({ title: "Error", description: "Failed to submit suggestion" });
  }
};


  const getSection = () => {
    if (!user) return "N/A";
    const name = user.name || "";
    const desc = user.description?.toLowerCase() || "";

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

    return user.section || "Unspecified";
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold">My Profile</h1>

      {/* User Info */}
      <Card>
        <CardHeader>
          <CardTitle>User Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {localStorage.getItem("adminViewAs") && (
            <p className="text-sm italic text-muted-foreground mb-2">
              Viewing as: <strong>{user?.name}</strong>
            </p>
          )}
          <p><strong>Full Name:</strong> {user?.name || "N/A"}</p>
          <p><strong>Role(s):</strong> {Array.isArray(user?.roles) ? user.roles.join(", ") : user?.roles}</p>
          <p><strong>Description:</strong> {user?.description || "N/A"}</p>
          <p><strong>Section:</strong> {getSection()}</p>
          <p><strong>Annual Leave Balances:</strong> {user?.leaveBalance ?? "N/A"} days</p>
          <p><strong>Off Days:</strong> {user?.offDayBalance ?? "N/A"} days</p> //test 
        </CardContent>
      </Card>

      {/* Toggle */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-3">
            <Switch
              checked={toastEnabled}
              onCheckedChange={(checked) => {
                setToastEnabled(checked);
                localStorage.setItem("notificationToastsEnabled", checked);
              }}
            />
            <Label>Enable popup toasts for new notifications</Label>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
   {/* Notifications */}
<Card>
  <CardHeader className="flex items-center justify-between">
    <CardTitle>Notifications Inbox</CardTitle>
    {notifications.length > 0 && (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
            const dismissed = JSON.parse(localStorage.getItem("dismissedNotifications") || "[]");
            const allTimestamps = notifications.map((n) => n.timestamp);
            const updated = [...new Set([...dismissed, ...allTimestamps])];
            localStorage.setItem("dismissedNotifications", JSON.stringify(updated));
            setNotifications([]);
        }}
        >
        Clear All
        </Button>

    )}
  </CardHeader>
  <CardContent>
    <div className="border rounded p-2 max-h-[300px] overflow-y-auto space-y-3">
      {notifications.length === 0 ? (
        <p className="text-muted-foreground text-sm">No notifications yet.</p>
      ) : (
        notifications.map((note) => (
          <div
            key={`${note.timestamp}-${note.title}-${note.message}`}
            className="relative border p-3 rounded bg-muted pr-10"
          >
           <button
            className="absolute top-1 right-1 text-gray-500 hover:text-red-500 text-xs"
            onClick={() => handleDismiss(note.timestamp)}
            >
            ✕
            </button>

            <p className="font-semibold">{note.title}</p>
            <p className="text-sm">{note.message}</p>
            <p className="text-xs text-gray-500 mt-1">
              {new Date(note.timestamp).toLocaleString()}
            </p>
          </div>
        ))
      )}
    </div>
  </CardContent>
</Card>


      {/* Suggestion Box */}
      <Card>
        <CardHeader>
          <CardTitle>Suggestion Box</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="Write your suggestion here..."
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
          />
          <Button onClick={handleSuggestionSubmit}>Submit Suggestion</Button>
        </CardContent>
      </Card>
    </div>
  );
}
