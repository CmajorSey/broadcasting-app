import { useState } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function ForgotPassword() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    const fullName = `${firstName} ${lastName}`.trim();
    if (!firstName.trim() || !lastName.trim()) {
      toast({ title: "Please enter your full name.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await fetch(`${API_BASE}/auth/request-admin-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: fullName }),
      });
      // Redirect back to login with a success flag for a professional toast
      navigate("/login", { state: { resetRequested: true } });
    } catch {
      toast({ title: "Error", description: "Could not submit request.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Request Password Reset</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-4">
            Enter your <strong>Name</strong> and <strong>Surname</strong>. We’ll notify the admin.
            They’ll generate a temporary password for you. After logging in with it, you’ll be asked
            to set a new password.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">Name</Label>
                <Input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Surname</Label>
                <Input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Sending…" : "Send request to Admin"}
            </Button>

            <p className="text-xs text-gray-600">
              You’ll see a confirmation on the login screen once the request is sent.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
