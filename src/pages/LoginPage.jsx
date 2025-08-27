import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage({ users, setLoggedInUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [debugMessage, setDebugMessage] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [siteName, setSiteName] = useState("Lo Board");
  const [loading, setLoading] = useState(false);

  // 🔹 Inline Forgot flow state
  const [showForgot, setShowForgot] = useState(false);
  const [fpFirst, setFpFirst] = useState("");
  const [fpLast, setFpLast] = useState("");
  const [fpSubmitting, setFpSubmitting] = useState(false);

  useEffect(() => {
    // Always fetch site branding
    fetch(`${API_BASE}/settings`)
      .then((res) => res.json())
      .then((data) => setSiteName(data?.siteName ?? "Lo Board"))
      .catch(() => setSiteName("Lo Board"));

    // One-time toasts based on navigation
    try {
      const navState = (location && location.state) || (window.history.state && window.history.state.usr);
      if (navState?.resetRequested) {
        toast({
          title: "Request sent",
          description:
            "Your password reset request has been sent to the admin. Please wait while they issue a temporary password.",
          duration: 4000,
        });
        navigate(location.pathname, { replace: true, state: {} });
      }
      if (navState?.justChangedPassword) {
        toast({
          title: "Password updated",
          description: "You can now log in with your new password.",
          duration: 3500,
        });
        navigate(location.pathname, { replace: true, state: {} });
      }
    } catch {}

    // Only check remembered user if not already logged in
    const alreadyLoggedIn = JSON.parse(localStorage.getItem("loggedInUser"));
    if (alreadyLoggedIn) return;

    const rememberedId = localStorage.getItem("rememberedUser");
    if (rememberedId) {
      fetch(`${API_BASE}/users/${rememberedId}`)
        .then((res) => res.json())
        .then((user) => {
          if (user?.name) {
            setName(user.name);
            setRemember(true);
          }
        })
        .catch(() => {});
    }
  }, []); // eslint-disable-line

  const handleLogin = async (e) => {
    e.preventDefault();
    setDebugMessage("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: name, password }),
      });

      // Handle explicit server-side gates up-front
      if (res.status === 410) {
        setDebugMessage("⏰ Your temporary password has expired. Please request a new one from the admin.");
        toast({
          title: "Temporary password expired",
          description: "Ask an admin to generate a new temporary password.",
          variant: "destructive",
        });
        return;
      }

      if (res.status === 428) {
        // Server is forcing a password change. Do not log in.
        const data = await res.json().catch(() => ({}));
        const u = data?.user;

        if (u?.id) {
          sessionStorage.setItem("pendingPasswordUser", JSON.stringify({ id: u.id, name: u.name }));
          // 👇 secretly keep the temp/default password so /auth/set-password can verify if needed
          sessionStorage.setItem("pendingPasswordSecret", password);
        }

        if (remember && u?.id) localStorage.setItem("rememberedUser", u.id);
        else localStorage.removeItem("rememberedUser");

        toast({
          title: "Password change required",
          description: "Please set a new password to continue.",
          duration: 3000,
        });
        navigate("/set-password", { state: { userId: u?.id, fromLogin: true } });
        return;
      }

      const data = await res.json();

      if (!res.ok || !data?.ok || !data?.user) {
        setDebugMessage(data?.error || "❌ Incorrect credentials.");
        return;
      }

      const user = data.user;

      // Defensive check (in case a proxy strips status codes)
      const mustChange =
        data?.loginPermitted === false ||
        !!data?.mustChangePassword ||
        !!data?.requiresPasswordChange ||
        !!user?.forcePasswordChange ||
        !!user?.requiresPasswordReset ||
        !!user?.passwordIsTemp;

      if (remember && user?.id) localStorage.setItem("rememberedUser", user.id);
      else localStorage.removeItem("rememberedUser");

      if (mustChange) {
        sessionStorage.setItem("pendingPasswordUser", JSON.stringify({ id: user.id, name: user.name }));
        sessionStorage.setItem("pendingPasswordSecret", password);
        toast({
          title: "Password change required",
          description: "Please set a new password to continue.",
          duration: 3000,
        });
        navigate("/set-password", { state: { userId: user.id, fromLogin: true } });
        return;
      }

      // ✅ Normal login
      // Clear any stale temp secret
      try { sessionStorage.removeItem("pendingPasswordSecret"); } catch {}
      localStorage.setItem("loggedInUser", JSON.stringify(user));
      setLoggedInUser(user);

      toast({
        title: `Welcome back, ${user.name?.split(" ")[0] || "there"}!`,
        description: "Logged in successfully.",
        duration: 2000,
      });

      setTimeout(() => {
        navigate("/");
      }, 600);
    } catch (err) {
      setDebugMessage("❌ Login failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 🔹 Inline Forgot submit
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    const first = fpFirst.trim();
    const last = fpLast.trim();
    if (!first || !last) {
      toast({ title: "Please enter your full name.", variant: "destructive" });
      return;
    }
    setFpSubmitting(true);
    try {
      await fetch(`${API_BASE}/auth/request-admin-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: `${first} ${last}` }),
      });
      toast({
        title: "Request sent",
        description:
          "We’ve notified the admin. They’ll issue a temporary password shortly.",
        duration: 4000,
      });
      setShowForgot(false);
      setFpFirst("");
      setFpLast("");
    } catch {
      toast({
        title: "Error",
        description: "Could not submit request.",
        variant: "destructive",
      });
    } finally {
      setFpSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 px-4 py-8">
      <div className="flex flex-col items-center mb-6 space-y-2">
        <h1 className="text-3xl font-bold text-gray-800">{siteName}</h1>
      </div>

      {/* 🔹 Toggle between Login form and inline Forgot flow */}
      {!showForgot ? (
        <form
          onSubmit={handleLogin}
          className="bg-white p-8 rounded shadow-md w-full max-w-md space-y-4"
        >
          <h2 className="text-xl font-semibold text-center text-gray-700">Login</h2>

          {debugMessage && (
            <div className="text-center text-sm text-red-600 font-medium">
              {debugMessage}
            </div>
          )}

          <input
            type="text"
            placeholder="Full Name or Email"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full"
            disabled={loading}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input w-full"
            disabled={loading}
          />

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={loading}
            />
            Remember me
          </label>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-2 rounded text-white ${
              loading ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {loading ? "Logging in..." : "Login"}
          </button>

          {/* ✅ Forgot password opens inline flow (no router dependency) */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowForgot(true)}
              className="text-sm underline text-blue-700 hover:text-blue-800"
            >
              Forgot password?
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={handleForgotSubmit}
          className="bg-white p-8 rounded shadow-md w-full max-w-md space-y-4"
        >
          <h2 className="text-xl font-semibold text-center text-gray-700">
            Request Password Reset
          </h2>
          <p className="text-sm text-gray-600">
            Enter your <strong>Name</strong> and <strong>Surname</strong>. We’ll notify the admin.
            They’ll generate a temporary password. After you log in with it, you’ll be asked to set
            a new password.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Name"
              value={fpFirst}
              onChange={(e) => setFpFirst(e.target.value)}
              className="input w-full"
              autoFocus
              required
            />
            <input
              type="text"
              placeholder="Surname"
              value={fpLast}
              onChange={(e) => setFpLast(e.target.value)}
              className="input w-full"
              required
            />
          </div>

          <button
            type="submit"
            disabled={fpSubmitting}
            className={`w-full py-2 rounded text-white ${
              fpSubmitting ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {fpSubmitting ? "Sending…" : "Send request to Admin"}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowForgot(false)}
              className="text-sm underline text-gray-600 hover:text-gray-700"
            >
              ← Back to Login
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
