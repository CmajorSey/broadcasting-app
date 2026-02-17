import { useState, useEffect, useRef } from "react";
// ✅ Ensure both hooks are imported from react-router-dom
import { useLocation, useNavigate } from "react-router-dom";
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function UserManagement({
  users,
  setUsers,
  defaultRoles,
  protectedRoles,
  // 👇 NEW: these come from AdminPanel (which receives them from AdminPage query params)
  highlightId = null,
  highlightName = null,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

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
  // Branding moved to SettingsPage — keep placeholder to avoid ref errors if any
const [branding, setBranding] = useState({ siteName: "" }); // no longer used here

  // 🔑 reset dialog state
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");

  // NEW: highlight state + refs to rows for scrollIntoView
  const [flashId, setFlashId] = useState(null);
  const rowRefs = useRef({}); // { [userId]: HTMLDivElement }

  // 🔧 Util: generate a readable temporary password
  const makeTempPassword = (name = "User") => {
    const first = String(name).split(" ")[0] || "User";
    const rand = Math.floor(100 + Math.random() * 900);
    return `${first}${rand}!`; // e.g., "Alex537!"
  };

 const handleResetPassword = async () => {
  const userId = resetTarget?.id ? String(resetTarget.id) : "";
  const tempPw = String(newPassword || "").trim();

  if (!userId) {
    toast({ title: "No user selected", variant: "destructive" });
    return;
  }

  if (!tempPw) {
    toast({
      title: "Temporary password required",
      description: "Click Generate or type a temporary password.",
      variant: "destructive",
    });
    return;
  }

  try {
    // ✅ Keep same default TTL as backend (72h)
    const TTL_HOURS = 72;
    const expiresIso = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: tempPw,

        // 👇 force new-password screen on next login
        forcePasswordChange: true,
        requiresPasswordReset: true,

        // ✅ Mark as temp + set expiry + audit stamp
        passwordIsTemp: true,
        tempPasswordExpires: expiresIso,
        passwordUpdatedAt: nowIso,

        // Optional hint (backend supports it if you keep it)
        tempPasswordTtlHours: TTL_HOURS,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.error || `Failed to reset password (${res.status})`);
    }

    toast({
      title: `Temp password set for ${resetTarget?.name || "user"}`,
      description: `Expires in ${TTL_HOURS} hours.`,
      duration: 3500,
    });

    // Your /users/:id PATCH returns RAW user (not { user })
    const updatedUser = data?.user || data;

    if (updatedUser?.id) {
      const updatedId = String(updatedUser.id);
      setUsers((prev) =>
        Array.isArray(prev)
          ? prev.map((u) => (String(u?.id) === updatedId ? updatedUser : u))
          : prev
      );
    }

    setResetTarget(null);
    setNewPassword("");
  } catch (err) {
    console.error("Reset failed", err);
    toast({
      title: "Failed to reset password",
      description: err?.message || "Could not reset password.",
      variant: "destructive",
    });
  }
};

  // Branding fetch moved to SettingsPage
useEffect(() => {
  // no-op
}, []);


  // ✅ Auto-open Reset dialog if query string requests it (existing behavior kept)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const byId = params.get("resetUser");
    const byName = params.get("resetName");

    if (byId && Array.isArray(users) && users.length) {
      const u = users.find((x) => String(x.id) === String(byId));
      if (u) {
        setResetTarget(u);
        setNewPassword(makeTempPassword(u.name));
        // remove the query params so refresh won’t reopen
        params.delete("resetUser");
        params.delete("resetName");
        navigate({ search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
        return;
      }
    }

    if (byName && Array.isArray(users) && users.length) {
      const lower = byName.trim().toLowerCase();
      const u = users.find((x) => String(x.name || "").toLowerCase() === lower);
      if (u) {
        setResetTarget(u);
        setNewPassword(makeTempPassword(u.name));
        params.delete("resetUser");
        params.delete("resetName");
        navigate({ search: params.toString() ? `?${params.toString()}` : "" }, { replace: true });
      }
    }
  }, [location.search, users, navigate]);

  // ✅ NEW: Highlight logic — when highlightId or highlightName present, scroll + flash the row
  useEffect(() => {
    if (!Array.isArray(users) || users.length === 0) return;

    let target = null;

    if (highlightId) {
      target = users.find((u) => String(u.id) === String(highlightId));
    }
    if (!target && highlightName) {
      const lower = String(highlightName).trim().toLowerCase();
      target = users.find((u) => String(u.name || "").toLowerCase() === lower);
    }

    if (target) {
      const el = rowRefs.current[target.id];
      if (el && typeof el.scrollIntoView === "function") {
        // Smooth scroll & center
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      // Trigger flash highlight for ~2s
      setFlashId(String(target.id));
      const t = setTimeout(() => setFlashId(null), 2000);
      return () => clearTimeout(t);
    }
  }, [users, highlightId, highlightName]);

  // Branding save moved to SettingsPage
const saveBranding = () => {
  // Gently redirect admins to the new Settings page for branding
  try {
    alert("Branding has moved to the Settings page.");
    navigate("/admin-settings");
  } catch {
    // swallow
  }
};

  const handleRoleChange = async (userId, role) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const hasRole = (user.roles || []).includes(role);
    const newRoles = hasRole
      ? user.roles.filter((r) => r !== role)
      : [...(user.roles || []), role];

    try {
      const res = await fetch(`${API_BASE}/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: newRoles }),
      });

      if (!res.ok) throw new Error("Failed to update roles");

      // Your /users/:id PATCH currently returns { success, user }
      const payload = await res.json();
      const updated = payload?.user || payload; // accept either format safely

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

    /* ===========================
       🔐 New-user temp password rules start
       - Ensure tempPasswordExpires is in the future
       - Mark password as temporary
       =========================== */
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // +7 days
    /* ===========================
       🔐 New-user temp password rules end
       =========================== */

    const newUser = {
      name,
      password: autoPassword,
      roles: newUserRoles,
      description: newUserDesc.trim(),
      hiddenRoles: [],

      // ✅ these flags must align with login logic
      forcePasswordChange: true,
      requiresPasswordReset: true,
      passwordIsTemp: true,
      tempPasswordExpires: expiresAtIso,
      passwordUpdatedAt: nowIso,
    };

    try {
      const res = await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });

      if (!res.ok) throw new Error("Failed to add user");

      const response = await res.json();
      // Your /users POST returns { success, user, tempPassword, message }
      const created = response?.user || response;
      if (created?.id) {
        setUsers((prev) => [...prev, created]);
      }

      // Nice UX for admin: show temp pass + expiry if backend doesn’t already
      toast({
        title: `User created: ${name}`,
        description: `Temporary password: ${response?.tempPassword || autoPassword} (expires ${expiresAtIso
          .replace("T", " ")
          .slice(0, 16)})`,
      });
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
        const updatedRoles = (user.roles || []).filter((r) => r !== roleToDelete);
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

  // Style helper for flashing highlight (inline so no global CSS dependency)
  const highlightStyle = (userId) =>
    String(flashId) === String(userId)
      ? { transition: "background-color 0.3s ease", backgroundColor: "rgba(250, 204, 21, 0.35)" } // amber-300 @ ~35%
      : { transition: "background-color 0.6s ease" };

    // =========================
  // NEW: Grouping + Sorting
  // =========================
  const hasRole = (u, role) => Array.isArray(u?.roles) && u.roles.includes(role);
  const isJournalist = (u) =>
    hasRole(u, "journalist") || hasRole(u, "sports_journalist");
  const inSportsTeam = (u) => {
    const desc = String(u?.description || "").toLowerCase();
    return hasRole(u, "sports_journalist") || desc.includes("sport");
  };

  // Decide the single display group for a user
  // Change: ONLY full drivers (driver) count for Operations; driver_limited does NOT.
  // Journalists with driver_limited remain under Journalists (News/Sports).
  const groupKeyFor = (u) => {
    if (hasRole(u, "admin")) return "admins";
    if (hasRole(u, "producer")) return "producers";
    if (hasRole(u, "camOp") || hasRole(u, "driver")) return "operations"; // <-- removed driver_limited
    if (isJournalist(u) && inSportsTeam(u)) return "journalists_sports";
    if (isJournalist(u)) return "journalists_news";
    // Fallback
    return "journalists_news";
  };

  const groupLabel = {
    operations: "Operations (Cam Ops & Drivers)",
    journalists_news: "Journalists – News",
    journalists_sports: "Journalists – Sports",
    producers: "Producers",
    admins: "Admins",
  };

  const groupsOrder = [
    "operations",
    "journalists_news",
    "journalists_sports",
    "producers",
    "admins",
  ];

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });

  const grouped = groupsOrder.reduce((acc, key) => ({ ...acc, [key]: [] }), {});
  (Array.isArray(users) ? users : []).forEach((u) => {
    grouped[groupKeyFor(u)].push(u);
  });
  groupsOrder.forEach((key) => {
    grouped[key].sort((a, b) => collator.compare(a?.name || "", b?.name || ""));
  });


  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">User Management</h2>

      {/* Users, grouped & alphabetized */}
      <div className="space-y-2">
        {groupsOrder.map((key, idx) => {
          const list = grouped[key] || [];
          if (!list.length) return null;

          return (
            <div key={key} className="space-y-2">
              {/* subtle divider except before first block */}
              {idx > 0 && <div className="h-px bg-gray-200 my-2" />}

              {/* small grey label */}
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
                {groupLabel[key]}
              </div>

              <div className="space-y-3">
                {list.map((user) => {
                  // Safe formatter: "YYYY-MM-DD HH:MM" or "Never"
                  // Uses lastOnline if present, otherwise falls back to lastLogin.
                  const prettyLastOnline = (() => {
                    const v = user?.lastOnline || user?.lastLogin;
                    if (!v) return "Never";
                    const d = new Date(v);
                    if (Number.isNaN(d.getTime())) return "Never";
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, "0");
                    const dd = String(d.getDate()).padStart(2, "0");
                    const hh = String(d.getHours()).padStart(2, "0");
                    const mi = String(d.getMinutes()).padStart(2, "0");
                    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
                  })();

                  return (
                    <div
                      key={user.id}
                      ref={(el) => {
                        if (el) rowRefs.current[user.id] = el;
                      }}
                      style={highlightStyle(user.id)}
                      className="border p-4 rounded-lg shadow-sm bg-gray-50 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-lg text-gray-700">
                            {user.name}
                          </h3>
                          {user.description && (
                            <p className="text-sm text-gray-500">
                              {user.description}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-1">
                            Last online:{" "}
                            <span className="opacity-80">
                              {prettyLastOnline}
                            </span>
                          </p>
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
                              setNewPassword(makeTempPassword(user.name));
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
                  );
                })}
              </div>
            </div>
          );
        })}
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
  <p className="text-sm text-gray-600">
    Branding has moved to the Settings page to keep things tidy.
  </p>
  <div className="flex gap-3">
    <button
  onClick={() => navigate("/admin-settings")}
  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
>
  Open Settings
</button>
    <button
      onClick={saveBranding}
      className="bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
      title="If clicked, you’ll be redirected to the Settings page."
    >
      I’ll move it later
    </button>
  </div>
</div>


      {/* 🔑 Reset Password Dialog */}
      {resetTarget && (
        <AlertDialog open={true} onOpenChange={() => setResetTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset Password</AlertDialogTitle>
              <AlertDialogDescription>
                Generate or enter a temporary password for{" "}
                <strong>{resetTarget.name}</strong>.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="flex gap-2">
              <Input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Temporary password"
              />
              <button
                type="button"
                className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
                onClick={() => setNewPassword(makeTempPassword(resetTarget.name))}
              >
                Generate
              </button>
            </div>

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
