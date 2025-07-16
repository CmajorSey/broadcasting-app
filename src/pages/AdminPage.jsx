import AdminPanel from "@/components/AdminPanel";

export default function AdminPage({ users, setUsers }) {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">
          Admin Panel
        </h1>
        <AdminPanel users={users} setUsers={setUsers} />
      </div>
    </div>
  );
}
