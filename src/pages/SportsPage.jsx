import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { getSectionPermissions } from "@/lib/permissions";

const LS_KEY = "hub_sports_events_v1";

const toISO = (d) => {
  try {
    const x = new Date(d);
    if (isNaN(x.getTime())) return "";
    return x.toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

const load = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const save = (items) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch {}
};

export default function SportsPage({ loggedInUser }) {
  const { toast } = useToast();
  const { canEdit, canSeeNotes } = getSectionPermissions("sports", loggedInUser);

  const [items, setItems] = useState(() => load());

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    save(items);
  }, [items]);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31"));
    return copy;
  }, [items]);

  const addEvent = () => {
    const cleanTitle = (title || "").trim();
    const cleanDate = toISO(date);

    if (!cleanTitle) {
      toast({ title: "Missing title", description: "Please enter an event title." });
      return;
    }
    if (!cleanDate) {
      toast({ title: "Missing date", description: "Please select a date." });
      return;
    }

    const newItem = {
      id: Date.now().toString(),
      title: cleanTitle,
      date: cleanDate,
      location: (location || "").trim(),
      note: (note || "").trim(),
      confirmed: true, // others can view calendar
      createdBy: loggedInUser?.name || "Unknown",
      createdAt: new Date().toISOString(),
    };

    setItems([newItem, ...items]);
    setTitle("");
    setDate("");
    setLocation("");
    setNote("");
    toast({ title: "Added", description: "Sporting event added to calendar." });
  };

  const removeItem = (id) => {
    setItems(items.filter((x) => x.id !== id));
    toast({ title: "Removed", description: "Event removed." });
  };

  return (
    <div className="p-4 space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Sports Hub</CardTitle>
          <div className="text-sm text-muted-foreground">
            {canEdit ? (
              <span>
                You can <b>edit</b> Sports events.
              </span>
            ) : (
              <span>View-only: you can see the Sports events calendar.</span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {canEdit && (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Event title</div>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Seychelles League Matchday"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Date</div>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Location</div>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="e.g. Stade Linite"
                  />
                </div>
              </div>

              {canSeeNotes && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Notes (internal)</div>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Coverage notes, kit, crew reminders…"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={addEvent}>Add Event</Button>
                <Badge variant="secondary">Visible to all users</Badge>
              </div>

              <Separator />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Sports Events Calendar</div>
              <Badge variant="outline">{sorted.length} item(s)</Badge>
            </div>

            {sorted.length === 0 ? (
              <div className="text-sm text-muted-foreground">No events yet.</div>
            ) : (
              <div className="space-y-2">
                {sorted.map((it) => (
                  <Card key={it.id} className="rounded-2xl">
                    <CardContent className="p-4 flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-semibold">{it.title}</div>
                        <div className="text-sm text-muted-foreground flex flex-wrap gap-2">
                          <Badge variant="secondary">{it.date}</Badge>
                          {it.location ? <Badge variant="secondary">{it.location}</Badge> : null}
                          {canSeeNotes && it.note ? <Badge variant="outline">Notes: {it.note}</Badge> : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Added by {it.createdBy} • {new Date(it.createdAt).toLocaleString()}
                        </div>
                      </div>

                      {canEdit && (
                        <Button variant="destructive" size="sm" onClick={() => removeItem(it.id)}>
                          Remove
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
