import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import API_BASE from "@/api";

export default function UserManagement({ users, setUsers, defaultRoles, protectedRoles }) {
  const [availableRoles, setAvailableRoles] = useState(defaultRoles);
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
  const [showAddRoleDialog, setShowAddRoleDialog] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserDesc, setNewUserDesc] = useState("");
  const [newUserRoles, setNewUserRoles] = useState([]);
  const [newRoleInput, setNewRoleInput] = useState("");
  const [roleToDelete, setRoleToDelete] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [userBeingEdited, setUserBeingEdited] = useState(null);
  const [branding, setBranding] = useState({ siteName: "" });
  const [resetTarget, setResetTarget] = useState(null);
const [newPassword, setNewPassword] = useState("");
const handleResetPassword = async () => {
  if (!resetTarget || !newPassword.trim()) return;

  try {
    const res = await fetch(`${API_BASE}/users/${resetTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword.trim() }),
    });

    if (!res.ok) throw new Error("Failed to reset password");

    toast({ title: "Password reset successfully" });
    setResetTarget(null);
  } catch (err) {
    console.error("Reset failed", err);
    toast({ title: "Failed to reset password", variant: "destructive" });
  }
};


  useEffect(() => {
    fetch(`${API_BASE}/settings`)
      .then((res) => res.json())
      .then((data) => {
        setBranding({ siteName: data.siteName || "" });
      })
      .catch((err) => console.error("Failed to load branding:", err));
  }, []);

  const saveBranding = () => {
    fetch(`${API_BASE}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(branding),
    })
      .then((res) => res.json())
      .then(() => alert("✅ Branding updated"))
      .catch((err) => {
        console.error("Branding update failed:", err);
        alert("⚠️ Failed to update branding");
      });
  };

  const handleRoleChange = async (userId, role) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const hasRole = (user.roles || []).includes(role);
    const newRoles = hasRole
      ? user.roles.filter((r) => r !== role)
      : [...user.roles, role];

    try {
      const res = await fetch(`${API_BASE}/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: newRoles }),
      });

      if (!res.ok) throw new Error("Failed to update roles");

      const updated = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
    } catch (err) {
      alert("Error updating roles: " + err.message);
    }
  };

  const handleAddRole = () => {
    const role = newRoleInput.trim();
    if (!role || availableRoles.includes(role)) return;
    setAvailableRoles((prev) => [...prev, role]);
    setNewRoleInput("");
    setShowAddRoleDialog(false);
  };

  const handleAddUser = async () => {
    if (!newUserName.trim()) {
      alert("Name is required");
      return;
    }

    const name = newUserName.trim();
    const firstName = name.split(" ")[0] || "User";
    const autoPassword = `${firstName}1`;

    const newUser = {
      name,
      password: autoPassword,
      roles: newUserRoles,
      description: newUserDesc.trim(),
      hiddenRoles: [],
      requiresPasswordReset: true,
    };

    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });

      if (!res.ok) throw new Error("Failed to add user");

      const response = await res.json();
      if (response?.id) {
        setUsers((prev) => [...prev, response]);
      }
    } catch (err) {
      alert("Error adding user: " + err.message);
    }

    setNewUserName("");
    setNewUserDesc("");
    setNewUserRoles([]);
    setShowAddUserDialog(false);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      const res = await fetch(`${API_BASE}/users/${userToDelete.id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete user");

      setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id));
      setUserToDelete(null);
    } catch (err) {
      alert("Error deleting user: " + err.message);
    }
  };

  const confirmDeleteRole = async () => {
    if (!roleToDelete) return;

    setAvailableRoles((prev) => prev.filter((r) => r !== roleToDelete));

    for (const user of users) {
      if ((user.roles || []).includes(roleToDelete)) {
        const updatedRoles = user.roles.filter((r) => r !== roleToDelete);
        try {
          await fetch(`${API_BASE}/users/${user.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roles: updatedRoles }),
          });
        } catch (err) {
          console.error("Role cleanup failed for", user.name, err);
        }
      }
    }

    setUsers((prev) =>
      prev.map((u) => ({
        ...u,
        roles: (u.roles || []).filter((r) => r !== roleToDelete),
      }))
    );

    setRoleToDelete(null);
  };

  const handleDeleteRole = (role) => {
    if (protectedRoles.includes(role)) {
      alert(`Cannot delete protected role: "${role}"`);
      return;
    }
    setRoleToDelete(role);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">User Management</h2>

      <div className="space-y-4">
  {users.map((user) => (
    <div
      key={user.id}
      className="border p-4 rounded-lg shadow-sm bg-gray-50 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg text-gray-700">{user.name}</h3>
          {user.description && (
            <p className="text-sm text-gray-500">{user.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            className="text-blue-600 text-sm underline hover:text-blue-800"
            onClick={() => setUserBeingEdited(user)}
          >
            ✏️ Edit
          </button>
          <button
            className="text-yellow-600 text-sm underline hover:text-yellow-800"
            onClick={() => {
              setResetTarget(user);
              setNewPassword("");
            }}
          >
            Reset Password
          </button>
          <button
            className="text-red-600 text-sm underline hover:text-red-800"
            onClick={() => setUserToDelete(user)}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {availableRoles.map((role) => {
          const isHidden = user.hiddenRoles?.includes(role);
          if (role === "admin" && isHidden) return null;

          return (
            <label key={role} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={(user.roles || []).includes(role)}
                onChange={() => handleRoleChange(user.id, role)}
              />
              <span>{role}</span>
            </label>
          );
        })}
      </div>
    </div>
  ))}
</div>

<div className="flex flex-wrap gap-4 pt-4 border-t">
  <button
    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
    onClick={() => setShowAddUserDialog(true)}
  >
    ➕ Add New User
  </button>

  <button
    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
    onClick={() => setShowAddRoleDialog(true)}
  >
    ➕ Add New Role
  </button>

  <select
    onChange={(e) => {
      const role = e.target.value;
      if (role) handleDeleteRole(role);
    }}
    defaultValue=""
    className="border border-gray-300 px-3 py-2 rounded text-gray-800"
  >
    <option value="">🗑️ Delete Role</option>
    {availableRoles
      .filter((r) => !protectedRoles.includes(r))
      .map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
  </select>
</div>

<div className="bg-white rounded shadow p-6 space-y-4 mt-6">
  <h2 className="text-lg font-semibold text-gray-700">Site Branding</h2>

  <div className="space-y-2">
    <label className="block text-sm text-gray-600">Welcome Text</label>
    <input
      type="text"
      value={branding.siteName}
      onChange={(e) => setBranding({ siteName: e.target.value })}
      className="input w-full border px-3 py-2 rounded"
      placeholder="Enter login screen title"
    />
  </div>
  <button
    onClick={saveBranding}
    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
  >
    Save Branding
  </button>
</div>

{resetTarget && (
  <AlertDialog open={true} onOpenChange={() => setResetTarget(null)}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Reset Password</AlertDialogTitle>
        <AlertDialogDescription>
          Enter a new password for <strong>{resetTarget.name}</strong>.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="New password"
      />
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={handleResetPassword}>
          Confirm
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)}

      {/* --- Add Role Dialog --- */}
      <AlertDialog open={showAddRoleDialog} onOpenChange={setShowAddRoleDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add New Role</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new role name to add to the list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="e.g. editor, technician"
            value={newRoleInput}
            onChange={(e) => setNewRoleInput(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddRole}>Add</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Add User Dialog --- */}
      <AlertDialog open={showAddUserDialog} onOpenChange={setShowAddUserDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add New User</AlertDialogTitle>
            <AlertDialogDescription>
              Fill in the new user's details.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <input
            className="w-full border rounded px-3 py-2 mb-2"
            placeholder="Full name"
            value={newUserName}
            onChange={(e) => setNewUserName(e.target.value)}
          />

          <input
            className="w-full border rounded px-3 py-2 mb-2"
            placeholder="Description (optional)"
            value={newUserDesc}
            onChange={(e) => setNewUserDesc(e.target.value)}
          />

          <div className="text-sm text-gray-600 font-medium mb-1">Assign Roles</div>
          <div className="flex flex-wrap gap-3 mb-4">
            {availableRoles.map((role) => (
              <label key={role} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={newUserRoles.includes(role)}
                  onChange={() =>
                    setNewUserRoles((prev) =>
                      prev.includes(role)
                        ? prev.filter((r) => r !== role)
                        : [...prev, role]
                    )
                  }
                />
                <span>{role}</span>
              </label>
            ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAddUser}>Add</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Confirm Delete Role Dialog --- */}
      <AlertDialog open={!!roleToDelete} onOpenChange={() => setRoleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Role Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the role "{roleToDelete}" from all users?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteRole}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Confirm Delete User Dialog --- */}
      <AlertDialog open={!!userToDelete} onOpenChange={() => setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {userToDelete?.name} from the system?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteUser}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
