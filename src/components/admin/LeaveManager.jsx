import { useEffect, useMemo, useRef, useState } from "react";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const toInt = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fb;
};

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
    } else if ((user.description || "").toLowerCase().includes("sports journalist")) {
      segments["Sports Section"].push(user);
    } else if ((user.description || "").toLowerCase().includes("journalist")) {
      segments.Newsroom.push(user);
    } else if ((user.description || "").toLowerCase().includes("producer")) {
      segments.Production.push(user);
    }
  });

  return segments;
};

export default function LeaveManager({ users, setUsers }) {
  const { toast } = useToast();

  // Drafts for immediate edit experience
  const [drafts, setDrafts] = useState({});
  const [savingUserId, setSavingUserId] = useState(null);

  // Remember which users we already auto-replenished this session/year
  const replenishedRef = useRef(new Set()); // keys like `${id}:${year}`

  // Map names -> IDs as a fallback if some users still lack id in memory
  const nameToId = useMemo(() => {
    const map = {};
    users.forEach((u) => {
      if (u?.name && u?.id) {
        map[u.name.toLowerCase()] = String(u.id);
      }
    });
    return map;
  }, [users]);

  const idOf = (u) => {
    if (!u) return null;
    if (u.id) return String(u.id);
    const key = (u.name || "").toLowerCase();
    return nameToId[key] || null;
  };

  // Initialize drafts from server users
  useEffect(() => {
    const next = {};
    users.forEach((u) => {
      if (u.name === "Admin") return;
      next[u.id || u.name] = {
        annualLeave: toInt(u.annualLeave ?? 0),
        offDays: toInt(u.offDays ?? 0),
      };
    });
    setDrafts(next);
  }, [users]);

  // Persist one field (only if changed)
  const persistField = async (userObj, field, rawValue) => {
    const uid = idOf(userObj);
    if (!uid) {
      toast({
        title: "Cannot save",
        description: `User "${userObj?.name || "Unknown"}" has no ID. Reload the page or contact admin.`,
        variant: "destructive",
      });
      return;
    }

    const value =
      field === "annualLeave"
        ? clamp(toInt(rawValue, 0), 0, 42)
        : Math.max(0, toInt(rawValue, 0));

    // Skip PATCH if no change vs current server state
    const current = users.find((u) => String(u.id) === String(uid));
    if (current && toInt(current[field] ?? 0) === value) return;

    setSavingUserId(uid);
    try {
      const res = await fetch(`${API_BASE}/users/${uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error(`Failed to update ${field}`);

      const data = await res.json();
      const saved = data?.user ?? data;

      // If the backend ever returns partial fields, merge to avoid row drops
      const merged = { ...(current || {}), ...saved };

      setUsers((prev) => prev.map((u) => (String(u.id) === String(uid) ? merged : u)));

      setDrafts((prev) => ({
        ...prev,
        [userObj.id || userObj.name]: {
          annualLeave: toInt(merged.annualLeave ?? 0),
          offDays: toInt(merged.offDays ?? 0),
        },
      }));

      toast({
        title: "Saved",
        description: `${field === "annualLeave" ? "Annual Leave" : "Off Days"} updated.`,
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err?.message || "Unable to persist change.",
        variant: "destructive",
      });
      const fallback = current || userObj;
      setDrafts((prev) => ({
        ...prev,
        [userObj.id || userObj.name]: {
          annualLeave: toInt(fallback.annualLeave ?? 0),
          offDays: toInt(fallback.offDays ?? 0),
        },
      }));
    } finally {
      setSavingUserId(null);
    }
  };

  // Yearly auto-replenish (adds 21 up to max 42), guarded so it runs once per user/year
  useEffect(() => {
    const now = new Date();
    const currentYear = now.getFullYear();

    users.forEach((user) => {
      if (user.name === "Admin") return;

      const uid = idOf(user);
      if (!uid) return;

      const key = `${uid}:${currentYear}`;
      if (replenishedRef.current.has(key)) return; // already processed this session

      const lastUpdated = user.lastLeaveUpdate ? new Date(user.lastLeaveUpdate) : null;
      const lastYear = lastUpdated?.getFullYear?.() ?? currentYear - 1;

      if (currentYear > lastYear) {
        const nextAnnual = clamp(toInt(user.annualLeave ?? 0) + 21, 0, 42);

        // Optimistically mark as processed to avoid loops even if request fails
        replenishedRef.current.add(key);

        fetch(`${API_BASE}/users/${uid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            annualLeave: nextAnnual,
            lastLeaveUpdate: now.toISOString(),
          }),
        })
          .then((res) => {
            if (!res.ok) throw new Error("Replenish failed");
            return res.json();
          })
          .then((data) => {
            const updatedUser = data?.user ?? data;
            // Merge to preserve any fields the server didn't echo
            const merged = { ...user, ...updatedUser };
            setUsers((prev) => prev.map((u) => (String(u.id) === String(uid) ? merged : u)));
          })
          .catch((err) => {
            console.error("Error replenishing leave:", err);
            // (we keep it marked as processed to avoid thrashing)
          });
      }
    });
  }, [users, setUsers]);

  const segments = useMemo(() => groupedBySegment(users), [users]);

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
                {segmentUsers.map((user, idx) => {
                  const rowKey = user.id || `${user.name}-${idx}`;
                  const draftKey = user.id || user.name;
                  const draft = drafts[draftKey] || { annualLeave: 0, offDays: 0 };
                  const uid = idOf(user);
                  const disabled = !uid;
                  const isSaving = savingUserId === uid;

                  return (
                    <tr key={rowKey} className="border-t">
                      <td className="p-2 border-r">{user.name}</td>
                      <td className="p-2 border-r">{user.description}</td>
                      <td className="p-2 border-r">
                        <input
                          type="number"
                          min={0}
                          max={42}
                          value={draft.annualLeave}
                          onChange={(e) => {
                            const val = clamp(toInt(e.target.value, 0), 0, 42);
                            setDrafts((prev) => ({
                              ...prev,
                              [draftKey]: { ...prev[draftKey], annualLeave: val },
                            }));
                          }}
                          onBlur={() => !disabled && persistField(user, "annualLeave", drafts[draftKey]?.annualLeave)}
                          className="w-24 border px-2 py-1 rounded"
                          disabled={disabled}
                          title={disabled ? "Cannot edit — user is missing an ID" : undefined}
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min={0}
                          value={draft.offDays}
                          onChange={(e) => {
                            const val = Math.max(0, toInt(e.target.value, 0));
                            setDrafts((prev) => ({
                              ...prev,
                              [draftKey]: { ...prev[draftKey], offDays: val },
                            }));
                          }}
                          onBlur={() => !disabled && persistField(user, "offDays", drafts[draftKey]?.offDays)}
                          className="w-24 border px-2 py-1 rounded"
                          disabled={disabled}
                          title={disabled ? "Cannot edit — user is missing an ID" : undefined}
                        />
                        {isSaving && <span className="ml-2 text-xs text-gray-500">Saving…</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
