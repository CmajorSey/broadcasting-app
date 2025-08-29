import { useLocation } from "react-router-dom";
import AdminPanel from "@/components/AdminPanel";

export default function AdminPage({ users, setUsers, loggedInUser }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  // Read deep-link query params for Step 4 flows
  const initialTab = params.get("tab") || undefined; // e.g. "user-management"
  const highlightId = params.get("highlight") || undefined; // userId
  const highlightName = params.get("highlightName") || undefined; // user name

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">
          Admin Panel
        </h1>
        <AdminPanel
          users={users}
          setUsers={setUsers}
          loggedInUser={loggedInUser}
          initialTab={initialTab}
          highlightId={highlightId}
          highlightName={highlightName}
        />
      </div>
    </div>
  );
}
