import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { getSectionPermissions } from "@/lib/permissions";

const LS_KEY = "hub_newsroom_presenters_v1";

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

export default function NewsroomPage({ loggedInUser, users = [] }) {
  const { toast } = useToast();
  const { canEdit } = getSectionPermissions("newsroom", loggedInUser);

  const [items, setItems] = useState(() => load());

  // v1 simple fields: program + date + presenter
  const [program, setProgram] = useState("Aktyalite");
  const [date, setDate] = useState("");
  const [presenter, setPresenter] = useState("");

  useEffect(() => {
    save(items);
  }, [items]);

  const sorted = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31"));
    return copy;
  }, [items]);

  const presenterOptions = useMemo(() => {
    // Keep it simple: any users list you pass in; later we can filter by journalist titles
    return (users || []).map((u) => u?.name).filter(Boolean);
  }, [users]);

  const add = () => {
    const cleanDate = toISO(date);
    const cleanPresenter = (presenter || "").trim();

    if (!cleanDate) {
      toast({ title: "Missing date", description: "Please select a date." });
      return;
    }
    if (!cleanPresenter) {
      toast({ title: "Missing presenter", description: "Please select/enter a presenter." });
      return;
    }

    const newItem = {
      id: Date.now().toString(),
      program: (program || "").trim() || "Aktyalite",
      date: cleanDate,
      presenter: cleanPresenter,
      createdBy: loggedInUser?.name || "Unknown",
      createdAt: new Date().toISOString(),
      confirmed: true, // view-only users can read this calendar
    };

    setItems([newItem, ...items]);
    toast({ title: "Saved", description: "Presenter schedule added." });
  };

  const removeItem = (id) => {
    setItems(items.filter((x) => x.id !== id));
    toast({ title: "Removed", description: "Schedule removed." });
  };

  return (
    <div className="p-4 space-y-4">
      <Card className="rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Newsroom Hub</CardTitle>
          <div className="text-sm text-muted-foreground">
            {canEdit ? (
              <span>
                You can <b>edit</b> presenter schedules.
              </span>
            ) : (
              <span>
                View-only: you can see who is presenting which program.
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {canEdit && (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Program</div>
                  <Input value={program} onChange={(e) => setProgram(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Date</div>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Presenter</div>
                  <Input
                    list="newsroom-presenters"
                    value={presenter}
                    onChange={(e) => setPresenter(e.target.value)}
                    placeholder="Start typing a name…"
                  />
                  <datalist id="newsroom-presenters">
                    {presenterOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={add}>Add Schedule</Button>
                <Badge variant="secondary">Visible to all users</Badge>
              </div>

              <Separator />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Presenter Calendar</div>
              <Badge variant="outline">{sorted.length} item(s)</Badge>
            </div>

            {sorted.length === 0 ? (
              <div className="text-sm text-muted-foreground">No schedules yet.</div>
            ) : (
              <div className="space-y-2">
                {sorted.map((it) => (
                  <Card key={it.id} className="rounded-2xl">
                    <CardContent className="p-4 flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-semibold">{it.program}</div>
                        <div className="text-sm text-muted-foreground flex flex-wrap gap-2">
                          <Badge variant="secondary">{it.date || "—"}</Badge>
                          <Badge variant="secondary">{it.presenter}</Badge>
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
