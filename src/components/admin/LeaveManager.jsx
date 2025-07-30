import { useEffect, useState } from "react";
import API_BASE from "@/api";

const groupedBySegment = (users) => {
  const segments = {
    Operations: [],
    "Sports Section": [],
    Newsroom: [],
    Production: [],
    Admins: [],
  };

  users.forEach((user) => {
    if (user.name === "Admin") return;

    const nameMatch = ["Clive Camille", "Jennifer Arnephy", "Gilmer Philoe"].includes(user.name);
    if (nameMatch) {
      segments.Admins.push(user);
    } else if (/cam ?op|camera ?operator|operations/i.test(user.description || "")) {
      segments.Operations.push(user);
    } else if (user.description?.toLowerCase().includes("sports journalist")) {
      segments["Sports Section"].push(user);
    } else if (user.description?.toLowerCase().includes("journalist")) {
      segments.Newsroom.push(user);
    } else if (user.description?.toLowerCase().includes("producer")) {
      segments.Production.push(user);
    }
  });

  return segments;
};

export default function LeaveManager({ users, setUsers }) {
  const [savingUserId, setSavingUserId] = useState(null);

  const handleAutoSave = async (id, field, value) => {
    setSavingUserId(id);
    const user = users.find((u) => u.id === id);
    if (!user) return;

    const updated = {
      ...user,
      [field]: value,
    };

    try {
      const res = await fetch(`${API_BASE}/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

      if (!res.ok) throw new Error("Failed to update leave balances");

      const saved = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === id ? saved : u)));
     } catch (err) {
      toast({
        title: "Save Failed",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSavingUserId(null);
    }

  };

  useEffect(() => {
    const now = new Date();
    const currentYear = now.getFullYear();

    const updatedUsers = users.map((user) => {
      if (user.name === "Admin") return user;

      const lastUpdated = user.lastLeaveUpdate ? new Date(user.lastLeaveUpdate) : null;
      const lastYear = lastUpdated?.getFullYear() ?? currentYear - 1;

      // Only replenish if year has changed
      if (currentYear > lastYear) {
        const newAnnualLeave = Math.min((user.annualLeave ?? 0) + 21, 42);

        // PATCH to backend and update local state
        fetch(`${API_BASE}/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            annualLeave: newAnnualLeave,
            lastLeaveUpdate: now.toISOString(),
          }),
        })
          .then((res) => res.json())
          .then((updatedUser) => {
            setUsers((prev) => prev.map((u) => (u.id === user.id ? updatedUser : u)));
          })
          .catch((err) => console.error("Error replenishing leave:", err));
      }

      return user;
    });

    // Do not setUsers here directly — we let PATCH responses handle that
  }, [users]);

  const segments = groupedBySegment(users);

  return (
    <div className="space-y-8">
      {Object.entries(segments).map(([segment, segmentUsers]) => (
        <div key={segment}>
          <h2 className="text-xl font-bold text-gray-800 mb-3">{segment}</h2>
          {segmentUsers.length === 0 ? (
            <p className="text-sm text-gray-500">No users in this segment</p>
          ) : (
            <table className="w-full text-sm border">
              <thead className="bg-gray-100">
                <tr>
                  <th className="text-left p-2 border-r">Name</th>
                  <th className="text-left p-2 border-r">Description</th>
                  <th className="text-left p-2 border-r">Annual Leave</th>
                  <th className="text-left p-2">Off Days</th>
                </tr>
              </thead>
              <tbody>
                {segmentUsers.map((user) => (
                  <tr key={user.id} className="border-t">
                    <td className="p-2 border-r">{user.name}</td>
                    <td className="p-2 border-r">{user.description}</td>
                    <td className="p-2 border-r">
                                        <input
                    type="number"
                    min={0}
                    max={42}
                    value={user.annualLeave || 0}
                    onChange={(e) => {
                        const val = Math.min(parseInt(e.target.value), 42);
                        handleAutoSave(user.id, "annualLeave", val);
                    }}
                    className="w-20 border px-2 py-1 rounded"
                    />

                    </td>
                    <td className="p-2">
                    <input
                        type="number"
                        min={0}
                        value={user.offDays || 0}
                        onChange={(e) =>
                        handleAutoSave(user.id, "offDays", parseInt(e.target.value))
                        }
                        className="w-20 border px-2 py-1 rounded"
                    />
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
