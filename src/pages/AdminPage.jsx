import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AdminPanel from "@/components/AdminPanel";

/* ===========================
   🔒 Admin detection (AdminPage)
   =========================== */
function isAdminUser(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const role = String(user?.role || "").toLowerCase();
  return roles.includes("admin") || role === "admin";
}

/* ===========================
   🧪 View-As resolver (AdminPage)
   - Admin access should follow acting user
   - If viewing as non-admin => block Admin page
   =========================== */
function readAdminViewAsFromStorage() {
  try {
    const raw = localStorage.getItem("adminViewAs");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export default function AdminPage({ users, setUsers, loggedInUser, effectiveUser = null, adminViewAs = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);

  // Read deep-link query params for Step 4 flows
  const initialTab = params.get("tab") || undefined; // e.g. "user-management"
  const highlightId = params.get("highlight") || undefined; // userId
  const highlightName = params.get("highlightName") || undefined; // user name

  const actingUser = useMemo(() => {
    const storageViewAs = typeof window !== "undefined" ? readAdminViewAsFromStorage() : null;
    return effectiveUser || adminViewAs || storageViewAs || loggedInUser;
  }, [effectiveUser, adminViewAs, loggedInUser]);

  const canSeeAdmin = isAdminUser(actingUser);

  useEffect(() => {
    if (!canSeeAdmin) {
      navigate("/", { replace: true });
    }
  }, [canSeeAdmin, navigate]);

  if (!canSeeAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white p-4 rounded-xl shadow-md w-full space-y-2">
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <div className="text-sm text-muted-foreground">
              Access denied. You must be an admin to view this page.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">
          Admin Panel
        </h1>

        <AdminPanel
          users={users}
          setUsers={setUsers}
          loggedInUser={actingUser}
          initialTab={initialTab}
          highlightId={highlightId}
          highlightName={highlightName}
        />
      </div>
    </div>
  );
}
