const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");

const app = express();
const PORT = 4000;

const options = {
  key: fs.readFileSync(path.join(__dirname, "localhost+2-key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "localhost+2.pem")),
};

app.use(cors());
app.use(express.json());

// ⚠️ Do not call app.listen() — use https.createServer below


app.use(cors());
app.use(express.json());

// Set up lowdb
const adapter = new JSONFile("db.json");
const db = new Low(adapter);

// Load initial data
await db.read();
db.data ||= {
  users: [],
  tickets: [],
  vehicles: [],
  rosters: {},
  version: "0.0.1"
};
await db.write();

// ROUTES

// ROUTES

app.get("/version", (req, res) => {
  res.json({ version: db.data.version });
});

// Serve static frontend
const frontendPath = path.join(__dirname, "dist"); // or "build" depending on your setup
app.use(express.static(frontendPath));

// Catch-all: send index.html for unknown routes
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// USERS
app.get("/users", (req, res) => {
  res.json(db.data.users);
});

app.get("/users/:id", (req, res) => {
  const user = db.data.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

app.post("/users", async (req, res) => {
  const { name, roles = [], description = "", hiddenRoles = [] } = req.body;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Name is required" });
  }

  const firstName = name.trim().split(" ")[0];
  const password = `${firstName}1`;

  const newUser = {
    id: Date.now().toString(),
    name: name.trim(),
    roles,
    description,
    hiddenRoles,
    password,
    requiresPasswordReset: true,
  };

  db.data.users.push(newUser);
  await db.write();
  res.status(201).json({ success: true, user: newUser }); // ✅ wrapped format
});

app.patch("/users/:id", async (req, res) => {
  const userIndex = db.data.users.findIndex((u) => u.id === Number(req.params.id));
  if (userIndex === -1) return res.status(404).json({ error: "User not found" });

  db.data.users[userIndex] = { ...db.data.users[userIndex], ...req.body };
  await db.write();
  res.json({ success: true, user: db.data.users[userIndex] });
});

app.delete("/vehicles/:id", async (req, res) => {
  const id = Number(req.params.id);
  const index = db.data.vehicles.findIndex((v) => v.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Vehicle not found" });
  }

  db.data.vehicles.splice(index, 1);
  await db.write();

  res.json({ success: true, deletedId: id });
});


app.delete("/users/:id", async (req, res) => {
  const idParam = req.params.id;

  const match = db.data.users.find(
    (u) => String(u.id) === String(idParam)
  );

  if (!match) {
    return res.status(404).json({ error: `User with ID ${idParam} not found` });
  }

  db.data.users = db.data.users.filter((u) => String(u.id) !== String(idParam));
  await db.write();
  res.json({ success: true, deletedId: idParam });
});


// TICKETS
app.get("/tickets", (req, res) => {
  res.json(db.data.tickets);
});

app.post("/tickets", async (req, res) => {
  const newTicket = { ...req.body, id: Date.now().toString() };
  db.data.tickets.push(newTicket);
  await db.write();
  res.status(201).json({ success: true, ticket: newTicket });
});

app.patch("/tickets/:id", async (req, res) => {
  const index = db.data.tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Ticket not found" });

  db.data.tickets[index] = { ...db.data.tickets[index], ...req.body };
  await db.write();
  res.json({ success: true, ticket: db.data.tickets[index] });
});

app.delete("/tickets/:id", async (req, res) => {
  const index = db.data.tickets.findIndex((t) => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Ticket not found" });

  db.data.tickets.splice(index, 1);
  await db.write();
  res.json({ success: true });
});

// VEHICLES
app.get("/vehicles", (req, res) => {
  res.json(db.data.vehicles);
});

app.patch("/vehicles/:id", async (req, res) => {
  const index = db.data.vehicles.findIndex((v) => v.id === Number(req.params.id));
  if (index === -1) return res.status(404).json({ error: "Vehicle not found" });

  db.data.vehicles[index] = { ...db.data.vehicles[index], ...req.body };
  await db.write();
  res.json({ success: true, vehicle: db.data.vehicles[index] });
});

// ROSTERS
app.get("/rosters/:weekStart", (req, res) => {
  const roster = db.data.rosters[req.params.weekStart];
  if (!roster) return res.status(404).json({ error: "Roster not found" });
  res.json(roster);
});

app.patch("/rosters/:weekStart", async (req, res) => {
  db.data.rosters[req.params.weekStart] = req.body;
  await db.write();
  res.json({ success: true });
});

// START SERVER
const https = require("https");

https.createServer(options, app).listen(PORT, () => {
  console.log(`✅ HTTPS Server running on https://localhost:${PORT}`);
});



