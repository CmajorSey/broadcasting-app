// src/components/admin/NotificationsPanel.jsx
// v0.6.3+ — Admin QoL: delete/clear notifications + reset-password action + keep existing UX (no edit UI)
// ✅ NEW: deep-link support → open History tab + scroll to Suggestions
import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import API_BASE from "@/api";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  const location = useLocation();
  const { toast } = useToast();

  /* ===========================
     🔊 App-level notify emit starts here
     - Sends a shaped note to App.jsx (fireGlobalAlert)
     - App decides: toast / sound / browser notif / push, etc.

     ✅ IMPORTANT:
     - Mark this as a LOCAL PREVIEW ONLY.
     - Real delivery to recipients must come from backend (/notifications + push/poll).
     =========================== */
    const emitAdminNotification = (note) => {
    try {
      /**
       * ✅ KEY FIX:
       * Local preview events are OPTIONAL.
       * If we always emit, the sender gets:
       * 1) Local preview (event bridge)
       * 2) Real delivery (backend push/poll)
       * => double notifications.
       *
       * Default is OFF to guarantee only 1 notification.
       *
       * To re-enable preview intentionally:
       * localStorage.setItem("loBoard.notificationsPanelLocalPreview", "true")
       */
      const previewEnabled =
        localStorage.getItem("loBoard.notificationsPanelLocalPreview") === "true";

      if (!previewEnabled) return;

      // Keep shape compatible with App.jsx fireGlobalAlert(note)
      window.dispatchEvent(
        new CustomEvent("loBoard:notify", {
          detail: {
            title: note?.title || "",
            message: note?.message || "",
            recipients: Array.isArray(note?.recipients) ? note.recipients : [],
            timestamp: note?.timestamp || new Date().toISOString(),
            category: note?.category || "admin",
            urgent: note?.urgent === true,

            // helpful metadata for debugging/dedup
            __source: "notifications-panel",

            /* ===========================
               🧪 Local preview flag starts here
               - App.jsx will ONLY show this event when this flag is true
               =========================== */
            __localPreview: true,
            __mode: "admin_preview",
            /* ===========================
               🧪 Local preview flag ends here
               =========================== */
          },
        })
      );
    } catch {
      // ignore
    }
  };
  /* ===========================
     🔊 App-level notify emit ends here
     =========================== */

  /* ===========================
     🧭 Deep-link routing starts here
     - /admin?tab=notifications&subtab=history&scroll=suggestions
     =========================== */
  const getQuery = () => new URLSearchParams(location.search);
  const getSubtab = () => {
    const q = getQuery();
    const sub = String(q.get("subtab") || "").trim();
    // safety: only allow known tabs
    if (sub === "history" || sub === "groups" || sub === "send") return sub;
    return "send";
  };
  const getScrollTarget = () => {
    const q = getQuery();
    return String(q.get("scroll") || "").trim();
  };

  const [activeTab, setActiveTab] = useState(getSubtab());
  const suggestionsRef = useRef(null);

  // keep activeTab in sync if URL changes (AdminGlobalToasts / navbar links)
  useEffect(() => {
    setActiveTab(getSubtab());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // scroll after tab is on "history"
  useEffect(() => {
    if (activeTab !== "history") return;

    const target = getScrollTarget();
    if (target !== "suggestions") return;

    // allow the DOM + suggestions section to render first
    const t = setTimeout(() => {
      try {
        if (suggestionsRef.current && typeof suggestionsRef.current.scrollIntoView === "function") {
          suggestionsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          const el = document.getElementById("suggestions");
          if (el && typeof el.scrollIntoView === "function") {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      } catch {
        // ignore
      }
    }, 200);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, location.search]);
  /* ===========================
     🧭 Deep-link routing ends here
     =========================== */

  // compose tab state (kept)
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  // ✅ urgent notifications (forces sound later in user rules)
  const [urgent, setUrgent] = useState(false);

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

      // If server errors, don’t crash UI
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("Groups fetch failed:", { status: res.status, body });
        setGroups([]);
        return;
      }

      const data = await res.json().catch(() => null);

      // Accept: [] OR { groups: [] } OR { data: [] }
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.groups)
        ? data.groups
        : Array.isArray(data?.data)
        ? data.data
        : [];

      setGroups(list);
    } catch (err) {
      console.error("Failed to fetch groups:", err);
      setGroups([]);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/notifications`);

      // Handle backend 500 safely (don’t try to .json() blindly)
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("Notifications history fetch failed:", {
          status: res.status,
          body,
        });
        setHistory([]);
        return;
      }

      const data = await res.json().catch(() => null);

      // Accept: [] OR { notifications: [] } OR { data: [] }
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.notifications)
        ? data.notifications
        : Array.isArray(data?.data)
        ? data.data
        : [];

      // Newest first
      const sorted = [...list].sort(
        (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
      );
      setHistory(sorted);
    } catch (err) {
      console.error("Failed to fetch notifications history:", err);
      setHistory([]);
    }
  };

  const fetchSuggestions = async () => {
    try {
      const res = await fetch(`${API_BASE}/suggestions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) {
        throw new Error("Non-JSON response from /suggestions");
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error("Expected array from /suggestions, got:", data);
        setSuggestions([]);
        return;
      }
      const normalized = data.map((s) => {
        const created = s.createdAt || s.timestamp || null;
        const tsId = created ? `ts:${isoSec(created)}` : null;
        return {
          id: String(s.id ?? tsId ?? ""),
          userId: s.userId ?? null,
          userName: s.userName || s.name || "Unknown",
          section: s.section || "General",
          message: s.message || s.text || s.suggestion || "",
          createdAt: created,
          status: s.status || (s.archived === true ? "archived" : "new"),
          response: s.response || "",
          respondedAt: s.respondedAt || null,
        };
      });
      setSuggestions(normalized);
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
      .flatMap((g) => (Array.isArray(g.userIds) ? g.userIds : []))
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

    const ts = new Date().toISOString();

    // ✅ One payload shape that your backend alias already understands
    // Backend reads: title, message, recipients, createdAt (optional), category, urgent, action.url
    const sendPayload = {
      title,
      message,
      recipients,
      createdAt: ts,
      timestamp: ts,
      category: "admin",
      urgent: urgent === true,
      action: { url: "/profile" },
    };

    const postJson = async (url, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }

      return res.json().catch(() => ({}));
    };

    try {
      // ✅ Primary path: /notifications/send (save + push attempt)
      // If this route is missing/unavailable, fallback to /notifications (save only)
      try {
        await postJson(`${API_BASE}/notifications/send`, sendPayload);
      } catch (e) {
        // fallback (still ensures inbox history works even if push is down)
        await postJson(`${API_BASE}/notifications`, sendPayload);
      }

      toast({ title: "Message sent!" });

      /* ===========================
         🔊 Admin send preview starts here
         ✅ ALWAYS preview what the admin just sent
         - Prevents confusion where other toasts (suggestions, etc.) appear instead
         - Still marked as __localPreview so App.jsx can treat as preview-only
         =========================== */
      emitAdminNotification({
        title: sendPayload.title,
        message: sendPayload.message,
        recipients: sendPayload.recipients,
        timestamp: sendPayload.timestamp,
        category: sendPayload.category,
        urgent: sendPayload.urgent,
      });
      /* ===========================
         🔊 Admin send preview ends here
         =========================== */

      setTitle("");
      setMessage("");
      setSelectedUsers([]);
      setSelectedSections([]);
      setUrgent(false);

      fetchHistory();
    } catch (err) {
      console.error("Notification error:", err);
      toast({ title: "Error", description: "Failed to send message." });
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
    const ts = isoSec(timestamp); // "YYYY-MM-DDTHH:MM:SS"
    if (!ts) {
      toast({ variant: "destructive", title: "Delete failed", description: "Invalid timestamp." });
      return;
    }
    // Ensure we send UTC by appending Z (server will normalize)
    const tsParam = `${ts}Z`;

    try {
      setDeletingTs(ts);
      const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(tsParam)}`, {
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

        // Match handleDelete(): ensure UTC by appending Z
        const tsParam = `${ts}Z`;

        try {
          await fetch(`${API_BASE}/notifications/${encodeURIComponent(tsParam)}`, {
            method: "DELETE",
          });
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
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v)}
      className="p-4 max-w-6xl mx-auto"
    >
      <TabsList className="mb-4">
        <TabsTrigger value="send">📢 Send Messages</TabsTrigger>
        <TabsTrigger value="history">🕓 History</TabsTrigger>
        <TabsTrigger value="groups">👥 Manage Groups</TabsTrigger>
      </TabsList>

      {/* SEND */}
      <TabsContent value="send">
        <div className="space-y-6">
          <h2 className="text-2xl font-bold">📢 Send Messages</h2>

          <div className="grid gap-4">
            <div>
              <label className="text-sm font-medium block mb-1">Title</label>
              <Input
                placeholder="Enter Message title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full"
              />
            </div>

            {/* ✅ urgent */}
            <div className="flex items-center gap-3">
              <Switch checked={urgent} onCheckedChange={(v) => setUrgent(!!v)} />
              <Label className="text-sm">
                Mark as <span className="font-medium">Urgent</span> (Forces sound notification)
              </Label>
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

            <Button onClick={handleSend}>Send Message</Button>
          </div>

          <hr className="my-6" />
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
                    <td className="py-1 px-2 font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{notif.title}</span>
                        {notif?.urgent === true ? <Badge>URGENT</Badge> : null}
                      </div>
                    </td>
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

        {/* 🔽 Collapsible: User Suggestions (beneath history) */}
        <div className="mt-6" id="suggestions" ref={suggestionsRef}>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">
              💡 User Suggestions {Array.isArray(suggestions) ? `(${suggestions.length})` : ""}
            </h3>
            <Button variant="ghost" size="sm" onClick={fetchSuggestions} title="Refresh suggestions">
              Refresh
            </Button>
          </div>
          <UserSuggestionsSection
            suggestions={suggestions}
            setSuggestions={setSuggestions}
            fetchSuggestions={fetchSuggestions}
          />
        </div>
      </TabsContent>

      {/* GROUPS */}
      <TabsContent value="groups">
        <GroupsManager />
      </TabsContent>
    </Tabs>
  );
}

/* -----------------------------
   User Suggestions Section
   - Renders under History tab
   - Matches backend schema:
     { id, userId, userName, section, message, createdAt, status, response }
------------------------------*/
function UserSuggestionsSection({ suggestions, setSuggestions, fetchSuggestions }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all"); // all | new | reviewed | responded | archived
  const [drafts, setDrafts] = useState({}); // id -> response text
  const [actingId, setActingId] = useState(null);

  /* ===========================
     🔔 Suggestion → Notification wiring starts here
     - When admin marks a suggestion as "reviewed" OR saves a response,
       notify the original user via backend /notifications.
     - This ensures inbox works even if they are offline.
     - ALSO sends PUSH (FCM) when backend supports it.
     =========================== */
  const sendSuggestionNotification = async (opts) => {
    try {
      const { userName, kind, suggestionMessage, responseText } = opts || {};

      const name = String(userName || "").trim();
      if (!name) return;

      const ts = new Date().toISOString();

      const short = (s, n = 140) => {
        const t = String(s || "").trim();
        if (!t) return "";
        return t.length > n ? t.slice(0, n - 1) + "…" : t;
      };

      let title = "💡 Suggestion Update";
      let message = "Your suggestion has been updated.";

      if (kind === "reviewed") {
        title = "💡 Suggestion Reviewed";
        message = `An admin reviewed your suggestion: “${short(suggestionMessage, 110)}”`;
      }

      if (kind === "responded") {
        title = "✅ Suggestion Response";
        message = `Response to your suggestion: “${short(
          suggestionMessage,
          90
        )}” • Reply: “${short(responseText, 110)}”`;
      }

      const payload = {
        title,
        message,
        recipients: [name],
        timestamp: ts,
        category: "suggestion",
        urgent: false,
      };

      // 1) Persist it (so MyProfile inbox / global poll sees it)
      await fetch(`${API_BASE}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null);

      // 2) ALSO attempt PUSH (non-blocking)
      //    - If your backend doesn't have a push endpoint yet, this fails silently.
      const pushBody = {
        title,
        body: message,
        message,
        recipients: [name],
        category: "suggestion",
        urgent: false,
        data: {
          category: "suggestion",
          kind: kind || "",
        },
      };

          const tryPost = async (url) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pushBody),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `HTTP ${res.status}`);
        }
        return true;
      };

      // ✅ Attempt PUSH (non-blocking) using backend-known route
      await (async () => {
        try {
          await tryPost(`${API_BASE}/notifications/send`);
          return true;
        } catch {
          // silently ignore (inbox/feed already saved above)
          return false;
        }
      })();

      // 3) Local dispatch removed:
      // Suggestions already persist into /notifications and will appear via inbox/polling.
      // Removing this prevents suggestion toasts from overriding the admin send-preview.
    } catch {
      // ignore
    }
  };
  /* ===========================
     🔔 Suggestion → Notification wiring ends here
     =========================== */


  const filtered = useMemo(() => {
    const list = Array.isArray(suggestions) ? suggestions.slice() : [];
    const norm = (s) => String(s || "").toLowerCase();
    const want = norm(statusFilter);
    const out = want === "all" ? list : list.filter((s) => norm(s.status) === want);
    // newest first
    out.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return out;
  }, [suggestions, statusFilter]);

  const patchSuggestion = async (id, body) => {
    setActingId(String(id));
    try {
      const res = await fetch(`${API_BASE}/suggestions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Update failed");

      // capture target BEFORE state mutates (for notification context)
      const target = Array.isArray(suggestions)
        ? suggestions.find((s) => String(s.id) === String(id))
        : null;

      // Optimistic merge update
      setSuggestions((prev) =>
        (prev || []).map((s) =>
          String(s.id) === String(id) ? { ...s, ...data?.suggestion, ...body } : s
        )
      );

      // ✅ Notify user on key state changes
      try {
        const status = String(body?.status || "").toLowerCase();
        const hasResponse = typeof body?.response === "string" && body.response.trim().length > 0;

        if (status === "reviewed") {
          await sendSuggestionNotification({
            userName: target?.userName,
            kind: "reviewed",
            suggestionMessage: target?.message,
          });
        }

        // If admin saved a response, notify (regardless of status field)
        if (hasResponse) {
          await sendSuggestionNotification({
            userName: target?.userName,
            kind: "responded",
            suggestionMessage: target?.message,
            responseText: body?.response,
          });
        }
      } catch {
        // ignore notification errors
      }

      return true;
    } catch (err) {
      console.error("Suggestion patch error:", err);
      toast({ variant: "destructive", title: "Failed to update suggestion" });
      return false;
    } finally {
      setActingId(null);
    }
  };

  const deleteSuggestion = async (id) => {
    if (!window.confirm("Delete this suggestion? This cannot be undone.")) return;
    setActingId(String(id));
    try {
      const res = await fetch(`${API_BASE}/suggestions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setSuggestions((prev) => (prev || []).filter((s) => String(s.id) !== String(id)));
      toast({ title: "Suggestion deleted" });
    } catch (err) {
      console.error("Suggestion delete error:", err);
      toast({ variant: "destructive", title: "Failed to delete suggestion" });
    } finally {
      setActingId(null);
    }
  };

  const sendResponse = async (id) => {
    const text = drafts[id] ?? "";
    if (!String(text).trim()) {
      toast({ variant: "destructive", title: "Response required" });
      return;
    }
    const ok = await patchSuggestion(id, { response: String(text).trim() });
    if (ok) {
      toast({ title: "Response saved" });
      // backend auto-sets status=responded if not provided
      setDrafts((d) => ({ ...d, [id]: "" }));
      fetchSuggestions(); // ensure we have respondedAt, etc.
    }
  };

  const markStatus = async (id, status) => {
    const ok = await patchSuggestion(id, { status });
    if (ok) {
      toast({ title: `Marked as ${status}` });
      fetchSuggestions();
    }
  };

  return (
    <div className="border rounded p-4 bg-muted/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-semibold text-blue-600 hover:underline"
      >
        {open ? "▼ Hide User Suggestions" : "► Show User Suggestions"}
      </button>

      {open && (
        <div className="mt-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 mb-3">
            {["all", "new", "reviewed", "responded", "archived"].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "secondary"}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchSuggestions()}
              title="Refresh suggestions"
            >
              Refresh
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border">
              <thead className="bg-muted">
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">User</th>
                  <th className="text-left py-2 px-2">Section</th>
                  <th className="text-left py-2 px-2">Message</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-left py-2 px-2">Response</th>
                  <th className="text-left py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const id = String(s.id);
                  const draft = drafts[id] ?? s.response ?? "";
                  return (
                    <tr key={id} className="border-b align-top">
                      <td className="py-2 px-2 whitespace-nowrap">
                        {s.createdAt ? new Date(s.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap">{s.userName || "Unknown"}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{s.section || "General"}</td>
                      <td className="py-2 px-2 max-w-sm break-words">{s.message}</td>
                      <td className="py-2 px-2">
                        <Badge>
                          {(s.status || "new").replace(/^\w/, (c) => c.toUpperCase())}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 w-[280px]">
                        <Textarea
                          className="min-h-[68px]"
                          value={draft}
                          onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                          placeholder="Write a response…"
                        />
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" onClick={() => sendResponse(id)} disabled={actingId === id}>
                            {actingId === id
                              ? "Saving…"
                              : s.response
                              ? "Update Response"
                              : "Send Response"}
                          </Button>
                          {s.respondedAt && (
                            <span className="text-xs text-muted-foreground self-center">
                              Responded {new Date(s.respondedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex flex-col gap-2 w-[160px]">
                          {s.status !== "reviewed" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => markStatus(id, "reviewed")}
                              disabled={actingId === id}
                            >
                              Mark Reviewed
                            </Button>
                          )}
                          {s.status !== "archived" && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => markStatus(id, "archived")}
                              disabled={actingId === id}
                            >
                              Archive
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => (id ? deleteSuggestion(id) : null)}
                            disabled={!id || actingId === id}
                            title={!id ? "No identifier available for deletion" : "Delete this suggestion"}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-muted-foreground">
                      No suggestions in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

