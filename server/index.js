console.log("🚨 First checkpoint reached");
// @ts-nocheck
import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";

import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("▶️ Running from:", __filename);

console.log("🚨 Imports completed");
console.log("🚨 ROUTE CHECKPOINT 1");

dotenv.config();

// ✅ Use persistent disk if on Render Starter plan
// ✅ Unified data path for both local and Render
const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://192.168.100.61:5173", // ✅ Your LAN frontend
    "https://loboard.netlify.app"
  ],
  methods: ["GET", "POST", "PATCH", "DELETE"],
  credentials: true
}));

app.use(express.json());

const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const VEHICLES_FILE = path.join(DATA_DIR, "vehicles.json");
const ROSTERS_FILE = path.join(DATA_DIR, "rosters.json");
const groupsPath = path.join(__dirname, "data", "notificationGroups.json");

// 🔧 Ensure data directory and files exist
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(ROSTERS_FILE)) {
  fs.writeFileSync(ROSTERS_FILE, JSON.stringify({}, null, 2));
}

if (!fs.existsSync(VEHICLES_FILE)) {
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify([]));
}

if (!fs.existsSync(TICKETS_FILE)) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify([]));
}

const USERS_DEFAULT_FILE = path.join(__dirname, "data", "users.json");

if (!fs.existsSync(USERS_FILE)) {
  // If disk file doesn't exist, copy from Git-tracked default
  const defaultUsers = fs.readFileSync(USERS_DEFAULT_FILE, "utf-8");
  fs.writeFileSync(USERS_FILE, defaultUsers);
}

if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(
      {
        siteName: "Byenveni Lo Board"
      },
      null,
      2
    )
  );
}
console.log("🚨 ROUTE CHECKPOINT 2");
console.log("🚨 ROUTE CHECKPOINT 3");
// ✅ GET all groups
app.get("/notification-groups", (req, res) => {
  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    const groups = JSON.parse(raw);
    res.json(groups);
  } catch (err) {
    console.error("Failed to read groups:", err);
    res.status(500).json({ error: "Failed to read groups" });
  }
});

// ✅ POST new group
app.post("/notification-groups", (req, res) => {
  const { name, userIds } = req.body;

  if (!name || !Array.isArray(userIds)) {
    return res.status(400).json({ error: "Invalid group data" });
  }

  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    const groups = JSON.parse(raw);

    const newGroup = {
      id: Date.now().toString(),
      name,
      userIds,
    };

    groups.push(newGroup);
    fs.writeFileSync(groupsPath, JSON.stringify(groups, null, 2));
    res.status(201).json(newGroup);
  } catch (err) {
    console.error("Failed to save group:", err);
    res.status(500).json({ error: "Failed to save group" });
  }
});

// ✅ PATCH update group
app.patch("/notification-groups/:id", (req, res) => {
  const { id } = req.params;
  const { name, userIds } = req.body;

  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    let groups = JSON.parse(raw);

    const index = groups.findIndex((g) => g.id === id);
    if (index === -1) return res.status(404).json({ error: "Group not found" });

    groups[index] = {
      ...groups[index],
      name: name || groups[index].name,
      userIds: Array.isArray(userIds) ? userIds : groups[index].userIds,
    };

    fs.writeFileSync(groupsPath, JSON.stringify(groups, null, 2));
    res.json(groups[index]);
  } catch (err) {
    console.error("Failed to update group:", err);
    res.status(500).json({ error: "Failed to update group" });
  }
});

// ✅ DELETE group
app.delete("/notification-groups/:id", (req, res) => {
  const { id } = req.params;

  try {
    const raw = fs.readFileSync(groupsPath, "utf-8");
    let groups = JSON.parse(raw);

    const newGroups = groups.filter((g) => g.id !== id);
    fs.writeFileSync(groupsPath, JSON.stringify(newGroups, null, 2));
    res.status(204).end();
  } catch (err) {
    console.error("Failed to delete group:", err);
    res.status(500).json({ error: "Failed to delete group" });
  }
});
console.log("🚨 ROUTE CHECKPOINT 4");
console.log("🚨 ROUTE CHECKPOINT 5");
// ✅ GET /notifications (returns all — frontend filters by user/section/group)
app.get("/notifications", (req, res) => {
  const notificationsPath = path.join(__dirname, "data", "notifications.json");

  try {
    const raw = fs.readFileSync(notificationsPath, "utf-8");
    const all = JSON.parse(raw);
    res.json(all); // Return all notifications
  } catch (err) {
    console.error("Failed to read notifications:", err);
    res.status(500).json({ error: "Could not read notifications" });
  }
});
app.delete("/notifications/:timestamp", (req, res) => {
  const notificationsPath = path.join(__dirname, "data", "notifications.json");
  const encoded = req.params.timestamp;

  try {
    const decoded = decodeURIComponent(encoded);
    const raw = fs.readFileSync(notificationsPath, "utf-8");
    const all = JSON.parse(raw);

    const updated = all.filter((n) => {
      try {
        return new Date(n.timestamp).toISOString().split(".")[0] !== new Date(decoded).toISOString().split(".")[0];
      } catch {
        return true;
      }
    });

    fs.writeFileSync(notificationsPath, JSON.stringify(updated, null, 2));
    console.log("🗑 Deleted notification:", decoded);
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to delete notification:", err);
    res.status(500).json({ error: "Could not delete notification" });
  }
});

console.log("🚨 ROUTE CHECKPOINT 6");
console.log("🚨 ROUTE CHECKPOINT 7");

// ✅ One-time restore: force import vehicles from Git-tracked copy
app.get("/force-import-vehicles", (req, res) => {
  const VEHICLES_DEFAULT_FILE = path.join(__dirname, "data", "vehicles.json");
  if (fs.existsSync(VEHICLES_DEFAULT_FILE)) {
    const defaultVehicles = fs.readFileSync(VEHICLES_DEFAULT_FILE, "utf-8");
    fs.writeFileSync(VEHICLES_FILE, defaultVehicles);
    res.json({ message: "✅ Live /data/vehicles.json has been overwritten from Git-tracked vehicles.json." });
  } else {
    res.status(404).json({ error: "Git-tracked vehicles.json not found." });
  }
});

// ✅ One-time restore: force import rosters from Git-tracked copy
app.get("/force-import-rosters", (req, res) => {
  const ROSTERS_DEFAULT_FILE = path.join(__dirname, "data", "rosters.json");
  if (fs.existsSync(ROSTERS_DEFAULT_FILE)) {
    const defaultRosters = fs.readFileSync(ROSTERS_DEFAULT_FILE, "utf-8");
    fs.writeFileSync(ROSTERS_FILE, defaultRosters);
    res.json({ message: "✅ Live /data/rosters.json has been overwritten from Git-tracked rosters.json." });
  } else {
    res.status(404).json({ error: "Git-tracked rosters.json not found." });
  }
});
console.log("🚨 ROUTE CHECKPOINT 8");
console.log("🚨 ROUTE CHECKPOINT 9");

// GET roster by weekStart
app.get("/rosters/:weekStart", (req, res) => {
  const { weekStart } = req.params;
  const filePath = ROSTERS_FILE;

  try {
    const fileData = fs.readFileSync(filePath);
    const rosters = JSON.parse(fileData);
    const rosterForWeek = rosters[weekStart] || [];
    res.json(rosterForWeek);
  } catch (error) {
    console.error("Error reading rosters:", error);
    res.status(500).json({ error: "Failed to read rosters" });
  }
});
app.patch("/rosters/:weekStart", (req, res) => {
  const { weekStart } = req.params;
  const filePath = ROSTERS_FILE;


  try {
    const fileData = fs.readFileSync(filePath);
    const rosters = JSON.parse(fileData);

    rosters[weekStart] = req.body;

    fs.writeFileSync(filePath, JSON.stringify(rosters, null, 2));
    res.json({ success: true, data: rosters[weekStart] });
  } catch (error) {
    console.error("Error updating roster:", error);
    res.status(500).json({ error: "Failed to update roster" });
  }
});



app.get("/settings", (req, res) => {
  try {
   const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (err) {
    console.error("Error reading settings:", err);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

app.patch("/settings", (req, res) => {
  try {
    const current = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    const updated = { ...current, ...req.body };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch (err) {
    console.error("Error writing settings:", err);
    res.status(500).json({ error: "Failed to update settings" });
  }
});
console.log("🚨 ROUTE CHECKPOINT 10");
console.log("🚨 ROUTE CHECKPOINT 11");


// ✅ Get all users
app.get("/users", (req, res) => {
  const raw = fs.readFileSync(USERS_FILE, "utf-8");
  const users = JSON.parse(raw);
  res.json(users);
});

// ✅ Get user by ID
app.get("/users/:id", (req, res) => {
  const id = req.params.id;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  const user = users.find((u) => String(u.id) === String(id));
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ message: "User not found" });
  }
});

// ✅ Add new user
app.post("/users", (req, res) => {
  const { name, roles = [], description = "", hiddenRoles = [] } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ message: "Name is required" });
  }

  const firstName = name.trim().split(" ")[0];
  const defaultPassword = `${firstName}1`;

  const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));

  const newUser = {
    id: Date.now().toString(),
    name: name.trim(),
    roles,
    description,
    hiddenRoles,
    password: defaultPassword,
    requiresPasswordReset: true,
  };

  users.push(newUser);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.status(201).json(newUser);
});
app.post("/notifications", (req, res) => {
  const notificationsPath = path.join(__dirname, "data", "notifications.json");
  const { title, message, recipients, createdAt } = req.body;

  if (!title || !message || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const raw = fs.readFileSync(notificationsPath, "utf-8");
    const current = JSON.parse(raw);

    const newNotification = {
      title,
      message,
      recipients,
      timestamp: createdAt || new Date().toISOString(),
    };

    current.push(newNotification);
    fs.writeFileSync(notificationsPath, JSON.stringify(current, null, 2));

    res.status(201).json(newNotification);
  } catch (err) {
    console.error("Failed to save notification:", err);
    res.status(500).json({ error: "Failed to write notification" });
  }
});

// ✅ POST route for user suggestions
app.post("/suggestions", (req, res) => {
  const suggestionsPath = path.join(__dirname, "data", "suggestions.json");
  const { name, message, timestamp } = req.body;

  if (!name || !message) {
    return res.status(400).json({ error: "Missing name or message" });
  }

  try {
    const raw = fs.existsSync(suggestionsPath)
      ? fs.readFileSync(suggestionsPath, "utf-8")
      : "[]";
    const all = JSON.parse(raw);

    const newSuggestion = {
      name,
      message,
      timestamp: timestamp || new Date().toISOString(),
      archived: false, // ✅ default to false
    };

    all.push(newSuggestion);
    fs.writeFileSync(suggestionsPath, JSON.stringify(all, null, 2));
    res.status(201).json(newSuggestion);
  } catch (err) {
    console.error("Failed to save suggestion:", err);
    res.status(500).json({ error: "Failed to write suggestion" });
  }
});

// ✅ GET route for suggestions
app.get("/suggestions", (req, res) => {
  const suggestionsPath = path.join(__dirname, "data", "suggestions.json");

  try {
    if (!fs.existsSync(suggestionsPath)) {
      return res.json([]);
    }

    const raw = fs.readFileSync(suggestionsPath, "utf-8");
    const suggestions = JSON.parse(raw);
    res.json(suggestions);
  } catch (err) {
    console.error("Failed to read suggestions:", err);
    res.status(500).json({ error: "Failed to load suggestions" });
  }
});

// ✅ PATCH route to archive/unarchive suggestions
app.patch("/suggestions/:timestamp", (req, res) => {
  const suggestionsPath = path.join(__dirname, "data", "suggestions.json");
  const { timestamp } = req.params;

  try {
    const raw = fs.readFileSync(suggestionsPath, "utf-8");
    const suggestions = JSON.parse(raw);

    const updated = suggestions.map((s) => {
      const baseTime = new Date(s.timestamp).toISOString().split(".")[0];
      const matchTime = new Date(timestamp).toISOString().split(".")[0];
      if (baseTime === matchTime) {
        return { ...s, archived: !s.archived };
      }
      return s;
    });

    fs.writeFileSync(suggestionsPath, JSON.stringify(updated, null, 2));
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to archive suggestion:", err);
    res.status(500).json({ error: "Failed to archive suggestion" });
  }
});



// ✅ Patch user
app.patch("/users/:id", (req, res) => {
  const id = req.params.id;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  const index = users.findIndex((u) => String(u.id) === String(id));

  if (index === -1) return res.status(404).json({ message: "User not found" });

  users[index] = { ...users[index], ...req.body };
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json(users[index]);
});

// ✅ Delete user
app.delete("/users/:id", (req, res) => {
  const id = req.params.id;
  let users = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
  const exists = users.some((u) => String(u.id) === String(id));

  if (!exists) return res.status(404).json({ message: "User not found" });

  users = users.filter((u) => String(u.id) !== String(id));
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json({ success: true, deletedId: id });
});
console.log("🚨 ROUTE CHECKPOINT 12");
console.log("🚨 ROUTE CHECKPOINT 13");

// ✅ Get all vehicles
app.get("/vehicles", (req, res) => {
  const raw = fs.readFileSync(VEHICLES_FILE, "utf-8");
  const vehicles = JSON.parse(raw);
  res.json(vehicles);
});

// ✅ Add or update vehicle
app.post("/vehicles", (req, res) => {
  const newVehicle = req.body;
  const vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf-8"));
  const existingIndex = vehicles.findIndex((v) => v.id === newVehicle.id);

  if (existingIndex !== -1) {
    vehicles[existingIndex] = { ...vehicles[existingIndex], ...newVehicle };
  } else {
    newVehicle.id = newVehicle.id || Date.now();
    vehicles.push(newVehicle);
  }

  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.status(200).json(newVehicle);
});

// ✅ Patch vehicle
app.patch("/vehicles/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const updatedData = req.body;
  const vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf-8"));
  const index = vehicles.findIndex((v) => v.id === id);

  if (index === -1) return res.status(404).json({ message: "Vehicle not found" });

  vehicles[index] = { ...vehicles[index], ...updatedData };
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.json(vehicles[index]);
});

// ✅ Delete vehicle
app.delete("/vehicles/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  let vehicles = JSON.parse(fs.readFileSync(VEHICLES_FILE, "utf-8"));
  const index = vehicles.findIndex((v) => v.id === id);

  if (index === -1) {
    return res.status(404).json({ message: "Vehicle not found" });
  }

  vehicles.splice(index, 1);
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.json({ success: true, deletedId: id });
});
console.log("🚨 ROUTE CHECKPOINT 14");
console.log("🚨 ROUTE CHECKPOINT 15");

// ✅ Get all tickets
// ✅ Get all tickets (file-based version)
app.get("/tickets", (req, res) => {
  try {
    const data = fs.readFileSync(TICKETS_FILE, "utf-8");
    const tickets = JSON.parse(data);
    res.json(tickets);
  } catch (error) {
    console.error("Failed to read tickets:", error);
    res.status(500).json({ error: "Failed to read tickets" });
  }
});

// ✅ Add ticket
app.post("/tickets", (req, res) => {
  try {
    const tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
    const newTicket = req.body;

    if (!newTicket.id) {
      newTicket.id = Date.now().toString();
    }

    tickets.push(newTicket);
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
    res.status(201).json(newTicket);
  } catch (error) {
    console.error("Failed to save ticket:", error);
    res.status(500).json({ error: "Failed to save ticket" });
  }
});

// ✅ Patch ticket by ID
app.patch("/tickets/:id", (req, res) => {
  try {
    const id = req.params.id;
    const tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
    const index = tickets.findIndex((t) => String(t.id) === String(id));

    if (index === -1) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    tickets[index] = { ...tickets[index], ...req.body };
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
    res.json({ success: true, updated: tickets[index] });
  } catch (error) {
    console.error("Failed to update ticket:", error);
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

// ✅ Delete ticket
app.delete("/tickets/:id", (req, res) => {
  try {
    const id = req.params.id;
    let tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
    const index = tickets.findIndex((t) => String(t.id) === String(id));

    if (index === -1) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    tickets.splice(index, 1);
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
    res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error("Failed to delete ticket:", error);
    res.status(500).json({ error: "Failed to delete ticket" });
  }
});
console.log("🚨 ROUTE CHECKPOINT 16");
console.log("🚨 ROUTE CHECKPOINT 17");

// ✅ Development tool: seed vehicles
app.get("/seed-vehicles", (req, res) => {
  const vehicles = [
    {
      id: 101,
      name: "Broadcast Van 1",
      status: "Available",
      notes: "Cleaned and fueled",
      insuranceExpiry: "2025-09-01",
      patentExpiry: "2025-12-01"
    },
    {
      id: 102,
      name: "Field Unit Car",
      status: "In Garage",
      notes: "Issue Reported",
      insuranceExpiry: "2025-10-15",
      patentExpiry: "2026-01-01"
    }
  ];
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2));
  res.json({ message: "🚐 Vehicles seeded!" });
});
console.log("🚨 ROUTE CHECKPOINT 18");
console.log("🚨 ROUTE CHECKPOINT 19");

// ✅ Health check
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// ✅ Start server on LAN
// ✅ Start HTTPS server on LAN
// ✅ Serve Vite production build
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

// Fallback to index.html for frontend routes (React SPA)
app.use((req, res, next) => {
  const knownPrefixes = [
    "/api",
    "/users",
    "/tickets",
    "/vehicles",
    "/rosters",
    "/seed-vehicles",
    "/notification-groups",
    "/notifications"
  ];

  if (knownPrefixes.some((prefix) => req.path.startsWith(prefix))) {
    return next(); // Let Express handle these API routes
  }

  res.sendFile(path.join(distPath, "index.html"));
});

console.log("🚨 ROUTE CHECKPOINT 20");
console.log("🚨 ROUTE CHECKPOINT 21");


// ✅ Start server on Render or LAN
try {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Backend server is running at http://0.0.0.0:${PORT}`);
  });
} catch (err) {
  console.error("🔥 Express server failed to start:", err.stack || err.message || err);
}

console.log("🚨 ROUTE CHECKPOINT 22");








