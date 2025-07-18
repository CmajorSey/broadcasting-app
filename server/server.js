const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const express = require("express");
const http = require("http");
const cors = require("cors");

const app = express();
const PORT = 4000;

const options = {
  key: fs.readFileSync(path.join(__dirname, "192.168.137.1-key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "192.168.137.1.pem")),
};

const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const VEHICLES_FILE = path.join(DATA_DIR, "vehicles.json");

app.use(cors({
  origin: [
    "https://loboard.netlify.app",
    "http://localhost:5173"
  ]
}));
app.use(express.json());

// 🔧 Ensure data directory and files exist
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(VEHICLES_FILE)) {
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify([]));
}

if (!fs.existsSync(TICKETS_FILE)) {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify([]));
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(
      [
        { id: 1, name: "Admin", password: "admin123", roles: ["admin"] },
        { id: 2, name: "Producer", password: "prod456", roles: ["producer"] },
        { id: 3, name: "CamOp", password: "cam789", roles: ["camOp"] },
        { id: 4, name: "Driver", password: "drive321", roles: ["driver"] }
      ],
      null,
      2
    )
  );
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


// ✅ Get all tickets
app.get("/tickets", (req, res) => {
  const tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
  res.json(tickets);
});

// ✅ Add ticket
app.post("/tickets", (req, res) => {
  const newTicket = req.body;
  const tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
  newTicket.id = newTicket.id || Date.now().toString();

  tickets.unshift(newTicket);
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
  res.status(201).json(newTicket);
});

// ✅ Patch ticket
app.patch("/tickets/:id", (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;
  const tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
  const index = tickets.findIndex((t) => String(t.id) === String(id));

  if (index === -1) return res.status(404).json({ message: "Ticket not found" });

  tickets[index] = { ...tickets[index], ...updatedData };
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));
  res.json(tickets[index]);
});

// ✅ Delete ticket
app.delete("/tickets/:id", (req, res) => {
  const id = req.params.id;
  const tickets = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"));
  const updated = tickets.filter((t) => String(t.id) !== String(id));

  fs.writeFileSync(TICKETS_FILE, JSON.stringify(updated, null, 2));
  res.json({ message: "Deleted successfully" });
});

// ✅ Optional ticket endpoint
app.post("/api/tickets", (req, res) => {
  const newTicket = req.body;
  if (!newTicket || !newTicket.title) {
    return res.status(400).json({ message: "Invalid ticket data." });
  }

  console.log("✅ New ticket received:", newTicket);
  res.status(201).json({ message: "Ticket saved successfully", ticket: newTicket });
});

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

// ✅ Health check
app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// ✅ Start server on LAN
// ✅ Start HTTPS server on LAN
// ✅ Serve Vite production build
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

// Fallback to index.html for SPA routes
// Fallback only for frontend (exclude API and static files)
app.get(/^\/(?!api\/|users|tickets|vehicles|seed-vehicles).*/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});


// ✅ Start HTTPS server on LAN
http.createServer(options, app).listen(PORT, "0.0.0.0", () => {
  console.log(`✅ HTTP Server running at http://192.168.100.61:${PORT}`);
});


