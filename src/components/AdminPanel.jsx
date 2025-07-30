import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import UserManagement from "@/components/admin/UserManagement";
import LeaveManager from "@/components/admin/LeaveManager";
import NotificationsPanel from "@/components/admin/NotificationsPanel";
import AdminStats from "@/components/admin/AdminStats";
import AdminSettings from "@/components/admin/AdminSettings";

const defaultRoles = ["journalist", "producer", "admin", "camOp", "driver", "driver_limited"];
const protectedRoles = ["admin"];

export default function AdminPanel({ users, setUsers, loggedInUser }) {
  const [tab, setTab] = useState("users");

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
