import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";

export default function LoginPage({ users, setLoggedInUser }) {
  const navigate = useNavigate();

  const [debugMessage, setDebugMessage] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [siteName, setSiteName] = useState("Lo Board");

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

    try {
      const res = await fetch(`${API_BASE}/users`);
      const allUsers = await res.json();

      const match = allUsers.find(
        (u) => u.name.trim().toLowerCase() === name.trim().toLowerCase()
      );

      if (!match) {
        setDebugMessage("❌ User not found.");
        return;
      }

      if (password !== match.password) {
        setDebugMessage("❌ Incorrect password.");
        return;
      }

      const defaultPassword = `${match.name.split(" ")[0]}1`;
      if (match.requiresPasswordReset && password === defaultPassword) {
        navigate("/set-password", { state: { user: match } });
        return;
      }

      if (remember) {
        localStorage.setItem("rememberedUser", match.id);
      } else {
        localStorage.removeItem("rememberedUser");
      }

      localStorage.setItem("loggedInUser", JSON.stringify(match));
      setLoggedInUser(match);
      navigate("/");
    } catch (err) {
      console.error("Login failed:", err.message);
      setDebugMessage("❌ Login failed: " + err.message);
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
          placeholder="Full Name (e.g. Christopher Gabriel)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input w-full"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input w-full"
        />

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember me
        </label>

        <button
          type="submit"
          className="bg-blue-600 text-white w-full py-2 rounded hover:bg-blue-700"
        >
          Login
        </button>
      </form>
    </div>
  );
}
