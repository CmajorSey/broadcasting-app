import { useState } from "react";
import API_BASE from "@/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [resetUrl, setResetUrl] = useState("");
  const { toast } = useToast();

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/auth/request-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setSent(true);
      if (data?.resetUrl) setResetUrl(data.resetUrl);
      toast({ title: "If that account exists, a reset link was created." });
    } catch {
      toast({ title: "Error", description: "Could not request reset.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Password Reset</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-3">
              <p className="text-sm">
                If the email is registered, a reset link has been created. Check your inbox.
              </p>
              {resetUrl ? (
                <p className="text-xs break-all">
                  Admin preview (development):{" "}
                  <a className="underline" href={resetUrl}>{resetUrl}</a>
                </p>
              ) : null}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </div>
              <Button type="submit" className="w-full">Send reset link</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
