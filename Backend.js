const express = require("express");
const fs = require("fs");
const https = require("https");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();

// 🔐 Add security headers
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

// ✅ Use environment variables for SSL paths (fallback to default if not set)
const keyPath = process.env.SSL_KEY_PATH || "/etc/letsencrypt/live/api.wesynchro.com/privkey.pem";
const certPath = process.env.SSL_CERT_PATH || "/etc/letsencrypt/live/api.wesynchro.com/fullchain.pem";

// 📜 Read SSL certificates
const server = https.createServer(
  {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  },
  app
);

// 🔌 Configure Socket.IO
const io = socketIo(server, {
  cors: {
    origin: [
      "https://synchro-kappa.vercel.app",
      "https://www.wesynchro.com",
      "http://localhost:3000"
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  perMessageDeflate: false,
  pingTimeout: 30000,
  pingInterval: 10000,
  allowEIO3: true,
  allowEIO4: true,
  cookie: false,
  serveClient: false,
  connectTimeout: 5000,
  maxHttpBufferSize: 1e8,
});

// 📦 Middleware
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 443;
let users = [];
let tickets = [];

// 🔁 Socket.IO logic
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  users.push({
    id: socket.id,
    lat: null,
    lng: null,
    isVisible: true,
    name: "Anonymous",
    role: "user",
    image: "",
  });

  socket.on("user-location", (data) => {
    if (!data?.lat || !data?.lng || !data?.role) return;

    const user = users.find((u) => u.id === socket.id);
    if (user) {
      user.lat = data.lat;
      user.lng = data.lng;
      user.role = data.role;
      user.name = data.name;
      user.isVisible = true;
      user.image = data.image;

      broadcastUsers();
    }
  });

  socket.on("visibility-change", (isVisible) => {
    const user = users.find((u) => u.id === socket.id);
    if (user) {
      user.isVisible = isVisible;
      broadcastUsers();
    }
  });

  socket.on("create-ticket", (ticket) => {
    if (
      ticket &&
      ticket.id &&
      ticket.lat &&
      ticket.lng &&
      ticket.message &&
      ticket.creatorId &&
      ticket.creatorName
    ) {
      tickets.push(ticket);
      io.emit("new-ticket", ticket);
      io.emit("all-tickets", tickets);
    } else {
      console.error("Invalid ticket data received:", ticket);
    }
  });

  socket.on("disconnect", () => {
    users = users.filter((u) => u.id !== socket.id);
    broadcastUsers();
    console.log(`User disconnected: ${socket.id}`);
  });

  function broadcastUsers() {
    const validUsers = users.filter(
      (user) =>
        user.isVisible &&
        user.lat !== null &&
        user.lng !== null &&
        user.name !== null &&
        user.role !== null &&
        user.image !== null
    );

    io.emit("nearby-users", validUsers);
    io.emit("all-tickets", tickets);
  }

  broadcastUsers();
});

// ✅ Use port 443 for HTTPS
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Secure server running on port ${PORT}`);
});
