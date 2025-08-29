import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import API_BASE from "@/api";

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // if auto-login can't complete for any reason, we show the dialog and send to Login
  const [showDoneDialog, setShowDoneDialog] = useState(false);

  // Prefer state → sessionStorage (pending flow) → localStorage (legacy)
  const pendingUser = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem("pendingPasswordUser") || "null");
    } catch {
      return null;
    }
  }, []);

  // Grab the secret temp/default password saved by Login (if present)
  const pendingSecret = useMemo(() => {
    try {
      return sessionStorage.getItem("pendingPasswordSecret") || "";
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    const stateUser = location.state?.user || null;
    const stateUserId = location.state?.userId || "";

    const storedLogged = (() => {
      try { return JSON.parse(localStorage.getItem("loggedInUser") || "null"); } catch { return null; }
    })();

    // Optional query params fallback: /set-password?u=<id>&name=<displayName>
    const qpId = searchParams.get("u") || "";
    const qpName = searchParams.get("name") || "";

    const id =
      stateUser?.id ||
      stateUserId ||
      pendingUser?.id ||
      qpId ||
      storedLogged?.id ||
      "";

    const name =
      stateUser?.name ||
      pendingUser?.name ||
      qpName ||
      storedLogged?.name ||
      "";

    setUserId(String(id || ""));
    setDisplayName(String(name || ""));
  }, [location.state, pendingUser, searchParams]);

  if (!userId) {
    return <p className="text-center p-6 text-red-500">Invalid access. Please log in again.</p>;
  }

  // --- Auto-login with the NEW password right after a successful set-password ---
  const autoLogin = async () => {
    try {
      // Resolve a stable identifier for /auth/login (email > username > name)
      const resUser = await fetch(`${API_BASE}/users/${userId}`);
      const u = await resUser.json().catch(() => ({}));
      const identifier = u?.email || u?.username || u?.name || displayName;
      if (!identifier) throw new Error("Could not resolve identifier for auto-login");

      const resLogin = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password: newPassword }),
      });

      // If backend still requires a change or says expired, fall back to Login
      if (resLogin.status === 410) {
        // expired temp (shouldn't happen after successful set, but guard anyway)
        setShowDoneDialog(true);
        return;
      }

      const data = await resLogin.json().catch(() => ({}));

      // New backend contract: if login returns mustChangePassword=true with 200,
      // treat it as "not fully logged" and show the fallback dialog.
      if (!resLogin.ok || !data?.ok || !data?.user || data?.mustChangePassword) {
        setShowDoneDialog(true);
        return;
      }

      // ✅ Persist session and land on /
      localStorage.setItem("loggedInUser", JSON.stringify(data.user));
      try {
        sessionStorage.removeItem("pendingPasswordUser");
        sessionStorage.removeItem("pendingPasswordSecret");
      } catch {}

      // Hard-redirect to ensure top-level app state refreshes
      window.location.replace("/");
    } catch {
      setShowDoneDialog(true);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!newPassword || !confirmPassword) {
      setError("Both password fields are required.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password too short (minimum 8 characters).");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          newPassword,
          // 👇 Send the original temp/default password silently if present,
          // so the server can verify when not flagged as forced-change.
          currentPassword: pendingSecret || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setError(
          data?.error ||
          (res.status === 410
            ? "Your temporary password has expired. Please request a new one from the admin."
            : "Failed to set password. Please try again.")
        );
        return;
      }

      // 👍 Password saved — immediately try to log in with the new credentials.
      await autoLogin();
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded shadow-md w-full max-w-md space-y-4"
      >
        <h1 className="text-xl font-bold text-center text-gray-800">
          Set New Password
        </h1>
        {displayName ? (
          <p className="text-center text-xs text-gray-500">Account: {displayName}</p>
        ) : null}

        {error && <p className="text-sm text-red-600 text-center">{error}</p>}

        <div className="space-y-2">
          <label className="text-sm font-medium">New password</label>
          <Input
            type="password"
            placeholder="Enter a strong password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Confirm new password</label>
          <Input
            type="password"
            placeholder="Re-enter password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={saving}>
          {saving ? "Saving…" : "Save Password"}
        </Button>
      </form>

      {/* Fallback dialog if auto-login couldn’t complete */}
      <AlertDialog open={showDoneDialog} onOpenChange={setShowDoneDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Password Saved</AlertDialogTitle>
            <AlertDialogDescription>
              Your password has been updated successfully. Please log in with your new password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                try {
                  sessionStorage.removeItem("pendingPasswordUser");
                  sessionStorage.removeItem("pendingPasswordSecret");
                } catch {}
                localStorage.removeItem("loggedInUser");
                navigate("/login", { replace: true, state: { justChangedPassword: true } });
              }}
            >
              Go to Login
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
