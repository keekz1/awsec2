const express = require("express");
const fs = require("fs");
const https = require("https");
const socketIo = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");

// Environment variables setup
require("dotenv").config();

const app = express();

// 🔒 Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    "https://synchro-kappa.vercel.app",
    "https://www.wesynchro.com",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// 📜 SSL Configuration (with full certificate chain)
const sslConfig = {
  key: fs.readFileSync(process.env.SSL_KEY_PATH || "/etc/letsencrypt/live/api.wesynchro.com/privkey.pem"),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH || "/etc/letsencrypt/live/api.wesynchro.com/fullchain.pem"),
  ca: [
    fs.readFileSync(process.env.SSL_CHAIN_PATH || "/etc/letsencrypt/live/api.wesynchro.com/chain.pem")
  ],
  minVersion: "TLSv1.2",
  ciphers: [
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256",
    "DHE-RSA-AES128-GCM-SHA256"
  ].join(":"),
  honorCipherOrder: true
};

const server = https.createServer(sslConfig, app);

// 🔌 Enhanced Socket.IO Configuration
const io = socketIo(server, {
  cors: {
    origin: cors().origin,
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  perMessageDeflate: {
    threshold: 1024,
    clientNoContextTakeover: true,
    serverNoContextTakeover: true
  },
  httpCompression: true,
  pingTimeout: 25000,
  pingInterval: 20000,
  maxHttpBufferSize: 1e7,
  connectTimeout: 10000,
  path: "/socket.io",
  serveClient: false,
  allowEIO3: true,
  allowEIO4: true,
  cookie: {
    name: "io",
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure: true
  }
});

// 📊 Connection monitoring
let connectionCount = 0;
const users = new Map();
const tickets = new Map();

// 🛠️ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔄 WebSocket Server Logic
io.on("connection", (socket) => {
  connectionCount++;
  console.log(`🔗 New connection (ID: ${socket.id}, Total: ${connectionCount})`);

  // Initialize user
  users.set(socket.id, {
    id: socket.id,
    lat: null,
    lng: null,
    isVisible: true,
    name: "Anonymous",
    role: "user",
    image: "",
    lastUpdate: Date.now()
  });

  // 🎯 Event handlers
  socket.on("user-location", (data) => {
    if (!validateLocationData(data)) return;
    
    const user = users.get(socket.id);
    if (user) {
      updateUser(user, data);
      broadcastUsers();
    }
  });

  socket.on("visibility-change", (isVisible) => {
    const user = users.get(socket.id);
    if (user) {
      user.isVisible = Boolean(isVisible);
      broadcastUsers();
    }
  });

  socket.on("create-ticket", (ticket) => {
    if (validateTicket(ticket)) {
      tickets.set(ticket.id, ticket);
      io.emit("new-ticket", ticket);
      broadcastTickets();
    }
  });

  socket.on("disconnect", () => {
    connectionCount--;
    users.delete(socket.id);
    console.log(`❌ Disconnected (ID: ${socket.id}, Remaining: ${connectionCount})`);
    broadcastUsers();
  });

  // 🛡️ Connection validation
  socket.use((event, next) => {
    if (["user-location", "create-ticket"].includes(event[0])) {
      if (!users.has(socket.id)) return next(new Error("Unauthorized"));
    }
    next();
  });

  // 🚨 Error handling
  socket.on("error", (err) => {
    console.error(`🚨 Socket error (${socket.id}):`, err.message);
  });
});

// 🔄 Broadcast functions
function broadcastUsers() {
  const validUsers = Array.from(users.values()).filter(user => 
    user.isVisible &&
    user.lat !== null &&
    user.lng !== null &&
    Date.now() - user.lastUpdate < 300000 // 5 minute staleness
  );
  
  io.emit("nearby-users", validUsers);
}

function broadcastTickets() {
  io.emit("all-tickets", Array.from(tickets.values()));
}

// ✅ Validation utilities
function validateLocationData(data) {
  return (
    data &&
    typeof data.lat === "number" &&
    typeof data.lng === "number" &&
    typeof data.role === "string" &&
    data.lat >= -90 && data.lat <= 90 &&
    data.lng >= -180 && data.lng <= 180
  );
}

function validateTicket(ticket) {
  return (
    ticket &&
    typeof ticket.id === "string" &&
    typeof ticket.lat === "number" &&
    typeof ticket.lng === "number" &&
    typeof ticket.message === "string" &&
    typeof ticket.creatorId === "string" &&
    typeof ticket.creatorName === "string"
  );
}

function updateUser(user, data) {
  user.lat = data.lat;
  user.lng = data.lng;
  user.role = data.role;
  user.name = data.name || "Anonymous";
  user.image = data.image || "";
  user.lastUpdate = Date.now();
}

// 🚀 Start server
const PORT = process.env.PORT || 443;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Secure server running on port ${PORT}`);
  console.log(`🔐 SSL Configuration:`);
  console.log(`- Using TLS v${sslConfig.minVersion}`);
  console.log(`- Ciphers: ${sslConfig.ciphers}`);
});

// 🧹 Cleanup on exit
process.on("SIGINT", () => {
  console.log("\n🔻 Shutting down gracefully...");
  io.close(() => {
    server.close(() => {
      console.log("✅ Server closed");
      process.exit(0);
    });
  });
});