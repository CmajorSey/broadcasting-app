import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import API_BASE from "@/api";


const defaultRoles = ["journalist", "producer", "admin", "camOp", "driver", "driver_limited"];
const protectedRoles = ["admin"];

function AdminPanel({ users, setUsers }) {
  const [availableRoles, setAvailableRoles] = useState(defaultRoles);
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
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? updated : u))
    );
  } catch (err) {
    alert("Error updating roles: " + err.message);
  }
};

const handleDescriptionChange = async (userId, newDesc) => {
  try {
    const res = await fetch(`${API_BASE}/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: newDesc }),
    });

    if (!res.ok) throw new Error("Failed to update description");

    const updated = await res.json();
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? updated : u))
    );
  } catch (err) {
    alert("Error updating description: " + err.message);
  }
};

const confirmDeleteRole = async () => {
  if (!roleToDelete) return;

  setAvailableRoles((prev) => prev.filter((r) => r !== roleToDelete));

  for (const user of users) {
    if ((user.roles || []).includes(roleToDelete)) {
      const updatedRoles = user.roles.filter((r) => r !== roleToDelete);
      try {
             const res = await fetch(`${API_BASE}/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: updatedRoles }),
        });

        if (!res.ok) throw new Error(`Failed to update ${user.name}`);
      } catch (err) {
        console.error("Role cleanup failed for user", user.name, err);
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
  const [showAddUserDialog, setShowAddUserDialog] = useState(false);
const [showAddRoleDialog, setShowAddRoleDialog] = useState(false);
const [newUserName, setNewUserName] = useState("");
const [newUserDesc, setNewUserDesc] = useState("");
const [newRoleInput, setNewRoleInput] = useState("");
const [roleToDelete, setRoleToDelete] = useState(null);
const [userToDelete, setUserToDelete] = useState(null);
 const handleAddRole = () => {
  const role = newRoleInput.trim();
  if (!role || availableRoles.includes(role)) return;

  setAvailableRoles((prev) => [...prev, role]);
  setNewRoleInput("");
  setShowAddRoleDialog(false);
};
const [newUserRoles, setNewUserRoles] = useState([]);
const [showBatchDialog, setShowBatchDialog] = useState(false);
const [batchRole, setBatchRole] = useState("");
const [batchUsers, setBatchUsers] = useState([
  { name: "", description: "" },
]);



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

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to add user: ${res.status} — ${errorText}`);
    }

    const response = await res.json();

    if (response && response.id) {
      setUsers((prev) => [...prev, response]);
    } else {
      console.error("Invalid user object returned:", response);
      throw new Error("Invalid user response from server");
    }
  } catch (err) {
    alert("Error adding user: " + err.message);
  }

  setNewUserName("");
  setNewUserDesc("");
  setNewUserPassword(""); // safe cleanup
  setNewUserRoles([]);
  setShowAddUserDialog(false);
};
const [userBeingEdited, setUserBeingEdited] = useState(null);

const [branding, setBranding] = useState({ siteName: "" });

useEffect(() => {
  fetch(`${API_BASE}/settings`)
    .then((res) => res.json())
    .then((data) => {
      setBranding({
        siteName: data.siteName || "",
      });
    })
    .catch((err) => console.error("Failed to load branding:", err));
}, 
[]);
const saveBranding = () => {
  fetch(`${API_BASE}/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(branding),
  })
    .then((res) => res.json())
    .then((data) => {
      alert("✅ Branding updated");
    })
    .catch((err) => {
      console.error("Branding update failed:", err);
      alert("⚠️ Failed to update branding");
    });
};



  return (
    <div className="bg-white p-6 rounded-xl shadow-md w-full max-w-4xl space-y-6">
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

      <div className="flex flex-col gap-4 pt-4 border-t">
  <div className="flex flex-wrap gap-4">
    <button
      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      onClick={() => setShowAddUserDialog(true)}
    >
      ➕ Add New User
    </button>
    <button
  className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
  onClick={() => setShowBatchDialog(true)}
>
  ➕ Add Users in Batch
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
        .filter((r) => !protectedRoles.includes(r)) // 👈 hide protected roles
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
      className="input w-full"
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


  {/* Role Reordering UI */}
  <div className="mt-2 space-y-1 text-sm text-gray-700">
    <div className="font-semibold">Reorder Roles</div>
    {availableRoles.map((role, index) => (
      <div key={role} className="flex items-center justify-between bg-gray-100 px-3 py-1 rounded">
        <span>{role}</span>
        <div className="space-x-2">
          <button
            onClick={() => {
              if (index > 0) {
                const updated = [...availableRoles];
                [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
                setAvailableRoles(updated);
              }
            }}
            disabled={index === 0}
            className="text-xs px-2 py-1 bg-gray-300 rounded disabled:opacity-50"
          >
            ↑
          </button>
          <button
            onClick={() => {
              if (index < availableRoles.length - 1) {
                const updated = [...availableRoles];
                [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
                setAvailableRoles(updated);
              }
            }}
            disabled={index === availableRoles.length - 1}
            className="text-xs px-2 py-1 bg-gray-300 rounded disabled:opacity-50"
          >
            ↓
          </button>
        </div>
      </div>
    ))}
  </div>
</div>
{/* --- Edit User Modal --- */}
<AlertDialog open={!!userBeingEdited} onOpenChange={() => setUserBeingEdited(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Edit User</AlertDialogTitle>
      <AlertDialogDescription>
        Update the name, description, or password for <span className="font-medium">{userBeingEdited?.name}</span>.
      </AlertDialogDescription>
    </AlertDialogHeader>

    {userBeingEdited && (
      <>
        <input
          className="w-full border rounded px-3 py-2 mb-2"
          placeholder="Full name"
          value={userBeingEdited.name}
          onChange={(e) =>
            setUserBeingEdited((prev) => ({ ...prev, name: e.target.value }))
          }
        />
        <input
          className="w-full border rounded px-3 py-2 mb-2"
          placeholder="Description (optional)"
          value={userBeingEdited.description || ""}
          onChange={(e) =>
            setUserBeingEdited((prev) => ({ ...prev, description: e.target.value }))
          }
        />
      </>
    )}

    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={async () => {
          try {
            const { id, name, description, password } = userBeingEdited;
            const updateFields = {
              name: name.trim(),
              description: description?.trim() || "",
            };
            if (password?.trim()) updateFields.password = password.trim();

            const res = await fetch(`${API_BASE}/users/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updateFields),
            });

            if (!res.ok) throw new Error("Failed to update user");

            const updated = await res.json();
            setUsers((prev) =>
              prev.map((u) => (u.id === id ? updated : u))
            );
            setUserBeingEdited(null);
          } catch (err) {
            alert("Error updating user: " + err.message);
          }
        }}
      >
        Save Changes
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

      {/* --- Add Role Dialog --- */}
<AlertDialog open={showAddRoleDialog} onOpenChange={setShowAddRoleDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Add New Role</AlertDialogTitle>
      <AlertDialogDescription>
        Enter a new role name. It will be added to the list of assignable roles.
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
        Fill in the new user's details below.
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
            onChange={() => {
              setNewUserRoles((prev) =>
                prev.includes(role)
                  ? prev.filter((r) => r !== role)
                  : [...prev, role]
              );
            }}
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
        Are you sure you want to remove{" "}
        <span className="font-medium">{userToDelete?.name}</span> from the system?
        This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction onClick={confirmDeleteUser}>Remove</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
{/* --- Batch Add Users Dialog --- */}
<AlertDialog open={showBatchDialog} onOpenChange={setShowBatchDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Add Users in Batch</AlertDialogTitle>
      <AlertDialogDescription>
        Select a role and add multiple users below. Passwords will be auto-generated as <code>FirstName1</code>.
      </AlertDialogDescription>
    </AlertDialogHeader>

    <select
      className="w-full border rounded px-3 py-2 mb-2"
      value={batchRole}
      onChange={(e) => setBatchRole(e.target.value)}
    >
      <option value="">-- Select Role --</option>
      {availableRoles.map((role) => (
        <option key={role} value={role}>{role}</option>
      ))}
    </select>

    <div className="space-y-2 max-h-60 overflow-y-auto">
      {batchUsers.map((user, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            className="border px-2 py-1 rounded w-1/2"
            placeholder="Full name"
            value={user.name}
            onChange={(e) => {
              const updated = [...batchUsers];
              updated[index].name = e.target.value;
              setBatchUsers(updated);
            }}
          />
          <input
            className="border px-2 py-1 rounded w-1/2"
            placeholder="Description (optional)"
            value={user.description}
            onChange={(e) => {
              const updated = [...batchUsers];
              updated[index].description = e.target.value;
              setBatchUsers(updated);
            }}
          />
          <button
            className="text-red-600 text-sm"
            onClick={() => {
              const updated = batchUsers.filter((_, i) => i !== index);
              setBatchUsers(updated);
            }}
          >
            ❌
          </button>
        </div>
      ))}
    </div>

    <div className="pt-2">
      <button
        className="text-blue-600 text-sm"
        onClick={() => setBatchUsers([...batchUsers, { name: "", description: "" }])}
      >
        ➕ Add Another Row
      </button>
    </div>

    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={async () => {
          if (!batchRole || batchUsers.length === 0) {
            alert("Select a role and add at least one user.");
            return;
          }

          const created = [];

          for (const u of batchUsers) {
            if (!u.name.trim()) continue;

            const name = u.name.trim();
            const firstName = name.split(" ")[0] || "User";
            const password = `${firstName}1`;

            const newUser = {
              name,
              password,
              roles: [batchRole],
              description: u.description?.trim() || "",
              hiddenRoles: [],
              requiresPasswordReset: true,
            };

            try {
              const res = await fetch(`${API_BASE}/users`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newUser),
              });

              if (res.ok) {
                const response = await res.json();
                created.push(response);
              }
            } catch (err) {
              console.error("Batch add error:", err);
            }
          }

          if (created.length) {
            setUsers((prev) => [...prev, ...created]);
          }

          setShowBatchDialog(false);
          setBatchUsers([{ name: "", description: "" }]);
          setBatchRole("");
        }}
      >
        Add Batch
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>


    </div>
  );
}

export default AdminPanel;
