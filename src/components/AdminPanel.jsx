import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import UserManagement from "@/components/admin/UserManagement";
import LeaveManager from "@/components/admin/LeaveManager";
import NotificationsPanel from "@/components/admin/NotificationsPanel";
import AdminStats from "@/components/admin/AdminStats";
import AdminSettings from "@/components/admin/AdminSettings";

const defaultRoles = ["journalist", "producer", "admin", "camOp", "driver", "driver_limited"];
const protectedRoles = ["admin"];

const VALID_TABS = new Set(["users", "leave", "notifications", "stats", "settings"]);

function normalizeInitialTab(initialTab, hasHighlight) {
  if (hasHighlight) return "users"; // force User Management when highlighting a user
  if (!initialTab) return "users";

  const t = String(initialTab).toLowerCase();
  if (t === "user-management" || t === "user_management") return "users"; // deep-link alias

  return VALID_TABS.has(t) ? t : "users";
}

export default function AdminPanel({
  users,
  setUsers,
  loggedInUser,
  initialTab,       // <-- from AdminPage query param ?tab=...
  highlightId,      // <-- from AdminPage query param ?highlight=<userId>
  highlightName,    // <-- from AdminPage query param ?highlightName=<name>
}) {
  const hasHighlight = Boolean(highlightId || highlightName);
  const [tab, setTab] = useState(() => normalizeInitialTab(initialTab, hasHighlight));

  // Keep tab in sync if the parent passes a different initialTab later (rare but safe)
  useEffect(() => {
    setTab((prev) => {
      const desired = normalizeInitialTab(initialTab, hasHighlight);
      return prev === desired ? prev : desired;
    });
  }, [initialTab, hasHighlight]);

  // These props get passed down so UserManagement can scroll & flash-highlight
  const highlightProps = useMemo(
    () => ({ highlightId: highlightId || null, highlightName: highlightName || null }),
    [highlightId, highlightName]
  );

  return (
    <div className="bg-white p-4 rounded-xl shadow-md w-full max-w-6xl space-y-4">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap gap-2 mb-4">
          <TabsTrigger value="users">User Management</TabsTrigger>
          <TabsTrigger value="leave">Leave Management</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UserManagement
            users={users}
            setUsers={setUsers}
            defaultRoles={defaultRoles}
            protectedRoles={protectedRoles}
            {...highlightProps}  // <-- new
          />
        </TabsContent>

        <TabsContent value="leave">
          <LeaveManager users={users} setUsers={setUsers} />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsPanel loggedInUser={loggedInUser} />
        </TabsContent>

        <TabsContent value="stats">
          <AdminStats users={users} />
        </TabsContent>

        <TabsContent value="settings">
          <AdminSettings users={users} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
