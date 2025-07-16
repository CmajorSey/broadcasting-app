import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import API_BASE from "@/api";

export default function LoginPage({ users, setLoggedInUser }) {
  const navigate = useNavigate();

  const [debugMessage, setDebugMessage] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const rememberedId = localStorage.getItem("rememberedUser");

    // Only pre-fill name; don't auto-login
    const alreadyLoggedIn = JSON.parse(localStorage.getItem("loggedInUser"));
    if (alreadyLoggedIn) return;

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

    // 🔍 Test backend connectivity immediately on load
    fetch("http://jsonplaceholder.typicode.com/users")
      .then((res) => {
        if (!res.ok) throw new Error("Status " + res.status);
        return res.json();
      })
      .then((data) =>
        setDebugMessage("✅ Connected: " + data.length + " users")
      )
      .catch((err) =>
        setDebugMessage("❌ Fetch failed: " + err.message)
      );
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();

    try {
      const res = await fetch(`${API_BASE}/users`);
      const allUsers = await res.json();

      const match = allUsers.find(
        (u) => u.name.trim().toLowerCase() === name.trim().toLowerCase()
      );

      if (!match) {
        alert("User not found");
        return;
      }

      if (password !== match.password) {
        alert("Incorrect password");
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
      alert("Failed to fetch user list: " + err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <form
        onSubmit={handleLogin}
        className="bg-white p-8 rounded shadow-md w-full max-w-md space-y-4"
      >
        <h1 className="text-2xl font-bold text-center text-gray-800">Login</h1>
        <p className="text-xs text-center text-red-500">{debugMessage}</p>

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
