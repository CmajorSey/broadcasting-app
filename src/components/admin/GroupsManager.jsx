import { useEffect, useState } from "react";
import API_BASE from "@/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Pencil, Save } from "lucide-react";
import MultiSelectCombobox from "@/components/MultiSelectCombobox";

export default function GroupsManager() {
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupEdits, setGroupEdits] = useState({}); // { [groupId]: { name, userIds (string[]), editing } }

  useEffect(() => {
    // Load groups (already persisted in /data/notificationGroups.json)
    fetch(`${API_BASE}/notification-groups`)
      .then((res) => res.json())
      .then((arr) => Array.isArray(arr) ? setGroups(arr) : setGroups([]))
      .catch((err) => {
        console.error("Failed to fetch groups", err);
        setGroups([]);
      });

    // Load users in a combobox-friendly, normalized shape (string IDs)
    fetch(`${API_BASE}/users-brief`)
      .then((res) => res.json())
      .then((arr) => {
        const filtered = Array.isArray(arr) ? arr.filter(u => u.name !== "Admin") : [];
        setUsers(filtered.map(u => ({
          id: String(u.id),
          name: String(u.name || ""),
          roles: Array.isArray(u.roles) ? u.roles : [],
          description: typeof u.description === "string" ? u.description : "",
        })));
      })
      .catch((err) => {
        console.error("Failed to fetch users", err);
        setUsers([]);
      });
  }, []);

  const createGroup = async () => {
    if (!newGroupName.trim()) return;

    const payload = {
      name: newGroupName.trim(),
      userIds: [],
    };

    try {
      const res = await fetch(`${API_BASE}/notification-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await res.json();
      setGroups((prev) => [...prev, saved]);
      setNewGroupName("");
    } catch (err) {
      console.error("Failed to create group:", err);
    }
  };

  const deleteGroup = async (id) => {
    if (!confirm("Are you sure you want to delete this group?")) return;
    try {
      await fetch(`${API_BASE}/notification-groups/${id}`, { method: "DELETE" });
      setGroups((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      console.error("Failed to delete group:", err);
    }
  };

  const saveGroupEdits = async (groupId) => {
    const edits = groupEdits[groupId];
    if (!edits) return;

    const updated = {
      id: groupId,
      name: edits.name,
      // normalize to string IDs to match server + notifications panel logic
      userIds: (edits.userIds || []).map(String),
    };

    try {
      const res = await fetch(`${API_BASE}/notification-groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      const saved = await res.json();

      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? saved : g))
      );

      setGroupEdits((prev) => {
        const copy = { ...prev };
        delete copy[groupId];
        return copy;
      });
    } catch (err) {
      console.error("Failed to save group edits", err);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create New Group</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Group name"
          />
          <Button onClick={createGroup}>Create</Button>
        </CardContent>
      </Card>

      {groups.map((group) => {
        // Make sure current edit state always uses string IDs for userIds
        const current = groupEdits[group.id] || {
          name: group.name,
          userIds: Array.isArray(group.userIds) ? group.userIds.map(String) : [],
        };

        const isEditing = !!groupEdits[group.id];

        return (
          <Card key={group.id}>
            <CardHeader className="flex flex-row justify-between items-center">
              {isEditing ? (
                <Input
                  className="w-1/2"
                  value={current.name}
                  onChange={(e) =>
                    setGroupEdits({
                      ...groupEdits,
                      [group.id]: {
                        ...current,
                        name: e.target.value,
                      },
                    })
                  }
                />
              ) : (
                <CardTitle>{group.name}</CardTitle>
              )}
              <div className="flex gap-2">
                {isEditing ? (
                  <Button size="icon" onClick={() => saveGroupEdits(group.id)}>
                    <Save size={16} />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    onClick={() =>
                      setGroupEdits({
                        ...groupEdits,
                        [group.id]: {
                          name: group.name,
                          userIds: Array.isArray(group.userIds) ? group.userIds.map(String) : [],
                        },
                      })
                    }
                  >
                    <Pencil size={16} />
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => deleteGroup(group.id)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </CardHeader>

            <CardContent>
              {isEditing ? (
                <div className="max-h-60 overflow-y-auto">
                  <MultiSelectCombobox
                    // Combobox expects [{label, value}], and we store selected as an array of string IDs
                    options={users.map((u) => ({ label: u.name, value: String(u.id) }))}
                    selected={current.userIds}
                    setSelected={(newIds) => {
                      setGroupEdits({
                        ...groupEdits,
                        [group.id]: {
                          ...current,
                          userIds: (newIds || []).map(String),
                        },
                      });
                    }}
                    placeholder="Select users..."
                    label="Users"
                  />
                </div>
              ) : (
                <ScrollArea className="max-h-64 overflow-y-auto pr-2 text-sm border rounded p-2">
                  <div className="space-y-1">
                    {users
                      .filter((u) =>
                        (Array.isArray(group.userIds) ? group.userIds.map(String) : []).includes(String(u.id))
                      )
                      .map((u) => (
                        <div key={u.id}>{u.name}</div>
                      ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

