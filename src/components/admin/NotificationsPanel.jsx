import { useState, useEffect } from "react";
import API_BASE from "@/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";
import { format } from "date-fns";
import GroupsManager from "@/components/admin/GroupsManager";
 import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";


export default function NotificationsPanel({ loggedInUser }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedSections, setSelectedSections] = useState([]);
  const [users, setUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const { toast } = useToast();

  const [groups, setGroups] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
const [showSuggestions, setShowSuggestions] = useState(false);

console.log("🔍 API_BASE is:", API_BASE);

useEffect(() => {
  fetchUsers();
  fetchHistory();

  fetch(`${API_BASE}/suggestions`)
  .then((res) => res.json())
  .then((data) => {
    if (Array.isArray(data)) setSuggestions(data);
    else console.error("Suggestions not an array", data);
  })
  .catch((err) => console.error("Failed to load suggestions:", err));


  fetch(`${API_BASE}/notification-groups`)
  .then((res) => {
    if (!res.ok) throw new Error("Failed to fetch groups");
    return res.json();
  })
  .then((data) => {
    if (Array.isArray(data)) setGroups(data);
    else throw new Error("Groups response not an array");
  })
  .catch((err) => {
    console.error("Failed to fetch groups", err);
    setGroups([]); // prevent map error
  });
}, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/users`);
      const data = await res.json();
      const filtered = data.filter((u) => u.name !== "Admin");
      setUsers(filtered);
    } catch (err) {
      console.error("Failed to fetch users:", err);
    }
  };

  const fetchHistory = async () => {
  try {
    const res = await fetch(`${API_BASE}/notifications?user=${encodeURIComponent(loggedInUser?.name || "")}`);
    const data = await res.json();

    if (!Array.isArray(data)) {
      console.error("Expected an array but got:", data);
      return;
    }

    setHistory(data.reverse());
  } catch (err) {
    console.error("Failed to fetch notifications history:", err);
  }
};

  const resolveRecipients = () => {
  if (selectedUsers.length > 0) return selectedUsers;

  const matchingGroupUsers = groups
    .filter((g) => selectedSections.includes(g.name))
    .flatMap((g) => g.userIds);

  const resolved = users.filter((u) => matchingGroupUsers.includes(u.id));
  return resolved.map((u) => u.name);
};


  const handleSend = async () => {
    const recipients = resolveRecipients();

    if (!title || !message || recipients.length === 0) {
      toast({
        title: "Missing Fields",
        description: "Please complete all fields.",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      title,
      message,
      recipients,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch(`${API_BASE}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Failed to send notification");

      toast({ title: "Notification sent!" });
      setTitle("");
      setMessage("");
      setSelectedUsers([]);
      setSelectedSections([]);
      fetchHistory();
    } catch (err) {
      console.error("Notification error:", err);
      toast({ title: "Error", description: "Failed to send notification." });
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchHistory();
  }, []);

 

return (
  <Tabs defaultValue="send" className="p-4 max-w-5xl mx-auto">
    <TabsList className="mb-4">
      <TabsTrigger value="send">📢 Send Notification</TabsTrigger>
      <TabsTrigger value="groups">👥 Manage Groups</TabsTrigger>
    </TabsList>

    <TabsContent value="send">
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">📢 Send Notification</h2>

        <div className="grid gap-4">
          <div>
            <label className="text-sm font-medium block mb-1">Title</label>
            <Input
              placeholder="Enter notification title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Message</label>
            <Textarea
              placeholder="Write your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full min-h-[100px]"
            />
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            <div className="w-full md:w-1/2">
              <label className="text-sm font-medium block mb-1">📁 Select Group(s)</label>
              <MultiSelectCombobox
                options={groups.map((g) => g.name)}
                selected={selectedSections}
                setSelected={(arr) => {
                  setSelectedSections(arr);
                  setSelectedUsers([]); // clear manual user selection if group chosen
                }}
                disabled={selectedUsers.length > 0}
                placeholder="Select group(s)..."
                label="Groups"
              />
            </div>

            <div className="w-full md:w-1/2">
              <label className="text-sm font-medium block mb-1">👤 Select Users</label>
              <MultiSelectCombobox
                options={users.map((u) => u.name)}
                selected={selectedUsers}
                setSelected={(arr) => {
                  setSelectedUsers(arr);
                  setSelectedSections([]);
                }}
                disabled={selectedSections.length > 0}
                placeholder="Search users..."
                label="Users"
              />
            </div>
          </div>

          <Button onClick={handleSend}>Send Notification</Button>
        </div>

        <hr className="my-6" />

        <h3 className="text-lg font-semibold">🕓 Notification History</h3>
<div className="overflow-x-auto">
  <table className="min-w-full text-sm border">
    <thead className="bg-muted">
      <tr className="border-b">
        <th className="text-left py-2 px-2">Date</th>
        <th className="text-left py-2 px-2">Title</th>
        <th className="text-left py-2 px-2">Message</th>
        <th className="text-left py-2 px-2">Recipients</th>
      </tr>
    </thead>
    <tbody>
      {history.map((notif, index) => (
        <tr key={index} className="border-b hover:bg-muted/50">
          <td className="py-1 px-2 whitespace-nowrap">
            {(() => {
              try {
                return new Date(notif.timestamp).toLocaleString();
              } catch {
                return "Invalid date";
              }
            })()}
          </td>
          <td className="py-1 px-2 font-medium">{notif.title}</td>
          <td className="py-1 px-2 max-w-sm break-words">{notif.message}</td>
          <td className="py-1 px-2 flex flex-wrap gap-1">
            {notif.recipients.map((r, i) => (
              <Badge key={i}>{r}</Badge>
            ))}
          </td>
        </tr>
      ))}
      {history.length === 0 && (
        <tr>
          <td colSpan={4} className="py-4 text-center text-muted-foreground">
            No notifications sent yet.
          </td>
        </tr>
      )}
    </tbody>
  </table>
</div>

{/* ✅ UPDATED: Suggestions with archive toggle */}
<div className="mt-6">
  <button
    onClick={() => setShowSuggestions(!showSuggestions)}
    className="text-sm font-semibold text-blue-600 hover:underline"
  >
    {showSuggestions ? "▼ Hide User Suggestions" : "► Show User Suggestions"}
  </button>

  {showSuggestions && (
    <div className="mt-4 border rounded p-4 bg-muted/30 max-h-[400px] overflow-y-auto space-y-4">
      {suggestions.filter((s) => !s.archived).length === 0 ? (
        <p className="text-sm text-muted-foreground">No unarchived suggestions.</p>
      ) : (
        suggestions
          .filter((s) => !s.archived)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .map((s, i) => (
            <div key={i} className="border-b pb-2 mb-2">
              <div className="flex items-center justify-between">
                <div className="font-medium">{s.name}</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={async () => {
                    try {
                      const res = await fetch(
                        `${API_BASE}/suggestions/${encodeURIComponent(s.timestamp)}`,
                        { method: "PATCH" }
                      );
                      if (!res.ok) throw new Error("Failed to archive");
                      const updated = suggestions.map((item) =>
                        item.timestamp === s.timestamp
                          ? { ...item, archived: true }
                          : item
                      );
                      setSuggestions(updated);
                      toast({ title: "Suggestion archived" });
                    } catch (err) {
                      console.error("Archive error:", err);
                      toast({ title: "Error", description: "Failed to archive" });
                    }
                  }}
                >
                  Archive
                </Button>
              </div>
              <div className="text-sm">{s.message}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(s.timestamp).toLocaleString()}
              </div>
            </div>
          ))
      )}
    </div>
  )}
</div>

      </div>
    </TabsContent>
    <TabsContent value="groups">
      <GroupsManager />
    </TabsContent>
  </Tabs>
);
}
