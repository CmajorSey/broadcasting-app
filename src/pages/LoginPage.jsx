import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage({ users, setLoggedInUser }) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [debugMessage, setDebugMessage] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [siteName, setSiteName] = useState("Lo Board");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Always fetch site branding
    fetch(`${API_BASE}/settings`)
      .then((res) => res.json())
      .then((data) => {
        console.log("🎯 SETTINGS LOADED:", data);
        setSiteName(data?.siteName ?? "Lo Board");
      })
      .catch((err) => {
        console.warn("Settings fetch failed", err);
        setSiteName("Lo Board");
      });

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
        .catch((err) => console.error("Error fetching remembered user", err));
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setDebugMessage("");
    setLoading(true);

    try {
      // ✅ Use backend login so bcrypt-hashed & legacy plaintext both work
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: name, password }),
      });

      const data = await res.json();

      if (!res.ok || !data?.ok || !data?.user) {
        setDebugMessage(data?.error || "❌ Incorrect credentials.");
        return;
      }

      const user = data.user;

      if (remember) {
        localStorage.setItem("rememberedUser", user.id);
      } else {
        localStorage.removeItem("rememberedUser");
      }

      localStorage.setItem("loggedInUser", JSON.stringify(user));
      setLoggedInUser(user);

      // 🎉 Success toast + gentle redirect delay
      toast({
        title: `Welcome back, ${user.name?.split(" ")[0] || "there"}!`,
        description: "Logged in successfully.",
        duration: 2000,
      });

      setTimeout(() => {
        navigate("/");
      }, 600);
    } catch (err) {
      console.error("Login failed:", err.message);
      setDebugMessage("❌ Login failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 px-4 py-8">
      <div className="flex flex-col items-center mb-6 space-y-2">
        <h1 className="text-3xl font-bold text-gray-800">{siteName}</h1>
      </div>

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

        {/* ✅ Forgot password link */}
        <div className="text-center">
          <a href="/forgot" className="text-sm underline text-blue-700 hover:text-blue-800">
            Forgot password?
          </a>
        </div>
      </form>
    </div>
  );
}
