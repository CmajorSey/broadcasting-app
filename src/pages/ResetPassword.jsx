import { useEffect, useState } from "react";
import API_BASE from "@/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function ResetPassword() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get("token") || "");
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      toast({ title: "Missing token", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password too short (min 8 chars)", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/auth/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setDone(true);
        toast({ title: "Password updated. You can log in now." });
      } else {
        toast({ title: "Invalid or expired link", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Could not reset password.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set a New Password</CardTitle>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-2">
              <p className="text-sm">Your password has been updated.</p>
              <a href="/login" className="underline text-sm">Go to Login</a>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm New Password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <Button type="submit" className="w-full">Update password</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
