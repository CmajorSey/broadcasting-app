// src/components/admin/NotificationsPanel.jsx
// v0.6.3 — Admin QoL: delete/clear notifications + reset-password action + keep existing UX (no edit UI)
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";
import GroupsManager from "@/components/admin/GroupsManager";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";

// -------- helpers ----------
const isoSec = (d) => {
  try {
    return new Date(d).toISOString().split(".")[0];
  } catch {
    return null;
  }
};
const uniq = (arr = []) => Array.from(new Set(arr.filter(Boolean)));

export default function NotificationsPanel({ loggedInUser }) {
  const navigate = useNavigate();
  const { toast } = useToast();

  // compose tab state (kept)
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedSections, setSelectedSections] = useState([]);
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [history, setHistory] = useState([]);

  // suggestions (kept)
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // loading flags
  const [deletingTs, setDeletingTs] = useState(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [resettingUserId, setResettingUserId] = useState(null);

  // derived combobox options
  const userNames = useMemo(() => users.map((u) => u.name), [users]);

  // ------- initial loads -------
  useEffect(() => {
    fetchUsers();
    fetchHistory();
    fetchSuggestions();
    fetchGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

    const fetchUsers = async () => {
    try {
      // Use backend-normalized shape: [{ id: "string", name: "..." , roles:[], description:"" }]
      const res = await fetch(`${API_BASE}/users-brief`);
      const data = await res.json();
      const filtered = Array.isArray(data)
        ? data.filter((u) => String(u.name).trim() && u.name !== "Admin")
        : [];
      // Keep as objects; the combobox uses names from useMemo(userNames)
      setUsers(
        filtered.map((u) => ({
          id: String(u.id),
          name: String(u.name),
          roles: Array.isArray(u.roles) ? u.roles : [],
          description: typeof u.description === "string" ? u.description : "",
        }))
      );
    } catch (err) {
      console.error("Failed to fetch users:", err);
      setUsers([]);
    }
  };


  const fetchGroups = async () => {
    try {
      const res = await fetch(`${API_BASE}/notification-groups`);
      if (!res.ok) throw new Error("groups fetch failed");
      const data = await res.json();
      setGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch groups:", err);
      setGroups([]);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications`);
      const data = await res.json();

      if (!Array.isArray(data)) {
        console.error("Expected an array but got:", data);
        setHistory([]);
        return;
      }

      // Newest first
      const sorted = [...data].sort(
        (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
      );
      setHistory(sorted);
    } catch (err) {
      console.error("Failed to fetch notifications history:", err);
    }
  };

  const fetchSuggestions = async () => {
    try {
      const res = await fetch(`${API_BASE}/suggestions`);
      const data = await res.json();
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load suggestions:", err);
      setSuggestions([]);
    }
  };

  // ------- compose/send -------
   const resolveRecipients = () => {
    // If user names were explicitly picked, send those
    if (selectedUsers.length > 0) {
      return selectedUsers;
    }

    // Otherwise, resolve group → userIds → user names
    const matchingGroupUsers = groups
      .filter((g) => selectedSections.includes(g.name))
      .flatMap((g) => Array.isArray(g.userIds) ? g.userIds : [])
      .map((id) => String(id));

    const resolved = users.filter((u) => matchingGroupUsers.includes(String(u.id)));
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

  // ------- history helpers -------
  const getDisplayRecipients = (notif) => {
    if (Array.isArray(notif.displayRecipients) && notif.displayRecipients.length > 0) {
      return notif.displayRecipients;
    }
    if (notif?.kind === "password_reset_request") return ["Admins"];
    return uniq(notif.recipients || []);
  };

  // ------- delete / clear -------
  const handleDelete = async (timestamp) => {
    const ts = isoSec(timestamp);
    if (!ts) {
      toast({ variant: "destructive", title: "Delete failed", description: "Invalid timestamp." });
      return;
    }
    try {
      setDeletingTs(ts);
      const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(ts)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast({ title: "Notification deleted" });
      fetchHistory();
    } catch (err) {
      console.error("Delete error:", err);
      toast({ variant: "destructive", title: "Could not delete notification" });
    } finally {
      setDeletingTs(null);
    }
  };

  const handleClearAll = async () => {
    try {
      setClearingAll(true);
      // delete one-by-one using the route your backend supports
      for (const n of history) {
        const ts = isoSec(n?.timestamp);
        if (!ts) continue;
        try {
          await fetch(`${API_BASE}/notifications/${encodeURIComponent(ts)}`, { method: "DELETE" });
          // tiny delay to avoid FS write thrash
          await new Promise((r) => setTimeout(r, 50));
        } catch {
          // ignore per-item errors; we refresh after loop
        }
      }
      toast({ title: "All notifications cleared" });
      await fetchHistory();
    } catch (err) {
      console.error("Clear error:", err);
      toast({ variant: "destructive", title: "Could not clear notifications" });
    } finally {
      setClearingAll(false);
    }
  };

  // ------- reset password from notif + redirect/highlight -------
  const handleResetPasswordFromNotification = async (notif) => {
    const userIdFromNotif = notif?.action?.userId;
    let userId = userIdFromNotif;

    // If server didn't embed userId, try to resolve via name
    if (!userId) {
      const name = notif?.action?.userName || notif?.message?.split(":")?.[1]?.trim();
      if (name) {
        const match = users.find(
          (u) => String(u.name).toLowerCase() === String(name).toLowerCase()
        );
        if (match) userId = match.id;
      }
    }

    if (!userId) {
      toast({
        variant: "destructive",
        title: "User not found",
        description: "Could not resolve the user to reset.",
      });
      return;
    }

    try {
      setResettingUserId(String(userId));
      const res = await fetch(
        `${API_BASE}/users/${encodeURIComponent(userId)}/temp-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours: 72 }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Reset failed");

      toast({
        title: "Temporary password created",
        description: `Temp: ${data?.tempPassword || "(hidden)"}`,
      });

      // deep-link into Admin Panel → User Management tab and highlight
      navigate(`/admin?tab=user-management&highlight=${encodeURIComponent(userId)}`);
    } catch (err) {
      console.error("Temp password error:", err);
      toast({ variant: "destructive", title: "Failed to reset password" });
    } finally {
      setResettingUserId(null);
    }
  };

  // ------- per-row action chooser -------
  const renderRowActions = (notif) => {
    const isReset = notif?.kind === "password_reset_request";
    const ts = isoSec(notif?.timestamp);

    return (
      <div className="flex items-center gap-2">
        {/* Delete (with native confirm to avoid extra imports) */}
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            if (!ts) {
              toast({
                variant: "destructive",
                title: "Delete failed",
                description: "Invalid timestamp.",
              });
              return;
            }
            if (window.confirm("Delete this notification? This cannot be undone.")) {
              handleDelete(notif?.timestamp);
            }
          }}
          disabled={!ts || deletingTs === ts}
          title="Delete this notification"
        >
          {deletingTs === ts ? "Deleting..." : "Delete"}
        </Button>

        {/* Reset now for password reset notifications */}
        {isReset ? (
          <Button
            size="sm"
            onClick={() => handleResetPasswordFromNotification(notif)}
            disabled={!!resettingUserId}
            title="Generate a temporary password and jump to User Management"
          >
            {resettingUserId ? "Working..." : "Reset now"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    );
  };

  return (
    <Tabs defaultValue="send" className="p-4 max-w-6xl mx-auto">
      <TabsList className="mb-4">
        <TabsTrigger value="send">📢 Send Notification</TabsTrigger>
        <TabsTrigger value="history">🕓 History</TabsTrigger>
        <TabsTrigger value="groups">👥 Manage Groups</TabsTrigger>
      </TabsList>

      {/* SEND */}
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
                    setSelectedUsers([]);
                  }}
                  disabled={selectedUsers.length > 0}
                  placeholder="Select group(s)..."
                  label="Groups"
                />
              </div>

              <div className="w-full md:w-1/2">
                <label className="text-sm font-medium block mb-1">👤 Select Users</label>
                <MultiSelectCombobox
                  options={userNames}
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

          {/* Suggestions section (kept) */}
          <div className="mt-2">
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

      {/* HISTORY */}
      <TabsContent value="history">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">🕓 Notification History</h3>
          <Button
            variant="secondary"
            onClick={() => {
              if (window.confirm("Clear ALL notifications? This cannot be undone.")) {
                handleClearAll();
              }
            }}
            disabled={clearingAll}
            title="Remove all notifications"
          >
            {clearingAll ? "Clearing…" : "Clear All"}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border">
            <thead className="bg-muted">
              <tr className="border-b">
                <th className="text-left py-2 px-2">Date</th>
                <th className="text-left py-2 px-2">Title</th>
                <th className="text-left py-2 px-2">Message</th>
                <th className="text-left py-2 px-2">Recipients</th>
                <th className="text-left py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((notif, index) => {
                const recipientsToShow = getDisplayRecipients(notif);
                return (
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
                      {recipientsToShow.map((r, i) => (
                        <Badge key={i}>{r}</Badge>
                      ))}
                    </td>
                    <td className="py-1 px-2">{renderRowActions(notif)}</td>
                  </tr>
                );
              })}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    No notifications yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      {/* GROUPS */}
      <TabsContent value="groups">
        <GroupsManager />
      </TabsContent>
    </Tabs>
  );
}
