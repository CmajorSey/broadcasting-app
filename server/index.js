import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./db.js";
import express from "express";
import http from "http";
import cors from "cors";

dotenv.config();
let db; // 🔑 Declare `db` so it's accessible globally

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

const app = express();
const PORT = 4000;



app.use(cors({
 origin: [
  "https://loboard.netlify.app",
  "http://localhost:5173",
  "http://192.168.100.61:5173"
],
   methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());


const options = {
  key: fs.readFileSync(path.join(__dirname, "192.168.137.1-key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "192.168.137.1.pem")),
};

const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const VEHICLES_FILE = path.join(DATA_DIR, "vehicles.json");
const ROSTERS_FILE = path.join(DATA_DIR, "rosters.json");



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
// GET roster by weekStart
app.get("/rosters/:weekStart", (req, res) => {
  const { weekStart } = req.params;
  const filePath = path.join(__dirname, "data", "rosters.json");

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
  const filePath = path.join(__dirname, "data", "rosters.json");

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
app.get("/tickets", async (req, res) => {
  try {
    console.log("📥 Incoming request to /tickets");
    const tickets = await db.collection("tickets").find({}).toArray();
    console.log("✅ Tickets fetched:", tickets.length);
    res.json(tickets);
  } catch (error) {
    console.error("❌ MongoDB fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch tickets", reason: error.message });
  }
});

// ✅ Add ticket (MongoDB version)
app.post("/tickets", async (req, res) => {
  try {
    const newTicket = req.body;
    newTicket.id = newTicket.id || Date.now().toString();

    const ticketsCollection = db.collection("tickets");
    await ticketsCollection.insertOne(newTicket);

    res.status(201).json(newTicket);
  } catch (error) {
    console.error("❌ Failed to save ticket to MongoDB:", error);
    res.status(500).json({ error: "Failed to save ticket" });
  }
});


// ✅ PATCH ticket safely by ID (string)
app.patch("/tickets/:id", async (req, res) => {
  try {
    const id = req.params.id.toString(); // keep as string
    const updatedData = { ...req.body };
    delete updatedData._id; // remove MongoDB’s immutable field

    console.log("🛠 PATCH ID:", id);
    console.log("📦 Cleaned update payload:", updatedData);

    // Strictly match string-form ID
    const result = await db.collection("tickets").findOneAndUpdate(
      { id: id },
      { $set: updatedData },
      { returnOriginal: false }
    );

    if (!result.value) {
      console.warn("⚠️ No ticket found for ID:", id);
      return res.status(404).json({ message: "Ticket not found" });
    }

    res.json({ success: true, updated: result.value });
  } catch (error) {
    console.error("❌ Failed to patch ticket:", error);
    res.status(500).json({
      error: "Failed to update ticket",
      reason: error.message,
      stack: error.stack,
    });
  }
});


// ✅ Delete ticket (MongoDB version)
app.delete("/tickets/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const result = await db.collection("tickets").deleteOne({ id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error("❌ Failed to delete ticket:", error);
    res.status(500).json({ error: "Failed to delete ticket" });
  }
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
// Fallback only for frontend (exclude API and static files)
app.get(/^\/(?!api\/|users|tickets|vehicles|rosters|seed-vehicles).*/, (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});



// ✅ Start HTTPS server on LAN
connectDB()
  .then((database) => {
    db = database;

    // ✅ Start server
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Backend server is running at http://0.0.0.0:${PORT} (LAN-enabled)`);
    });
  })
  .catch((err) => {
    console.error("❌ Could not connect to MongoDB. Server not started.");
    console.error(err);
  });







