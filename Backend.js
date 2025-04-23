const express = require("express");
const fs = require("fs");
const https = require("https");
const socketIo = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");

 require("dotenv").config();

const app = express();

 app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.wesynchro.com", "wss://api.wesynchro.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  hsts: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: "same-origin" }
}));

 const corsOptions = {
  origin: [
    "https://synchro-kappa.vercel.app",
    "https://www.wesynchro.com", 
    "http://localhost:3000"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

//  SSL Configuration
const sslConfig = {
  key: fs.readFileSync('/etc/letsencrypt/live/api.wesynchro.com-0001/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/api.wesynchro.com-0001/fullchain.pem'),
  minVersion: "TLSv1.2",
  ciphers: [
    "TLS_AES_256_GCM_SHA384",
    "TLS_CHACHA20_POLY1305_SHA256",
    "TLS_AES_128_GCM_SHA256",
    "ECDHE-ECDSA-AES128-GCM-SHA256",
    "ECDHE-RSA-AES128-GCM-SHA256"
  ].join(":"),
  honorCipherOrder: true
};

const server = https.createServer(sslConfig, app);

//WebSocket Server Configuration
const io = socketIo(server, {
  cors: corsOptions,
  transports: ["websocket"],
  allowUpgrades: false,
  perMessageDeflate: {
    threshold: 1024,
    memLevel: 6,
    clientNoContextTakeover: true,
    serverNoContextTakeover: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
  connectTimeout: 10000,
  path: "/socket.io",
  serveClient: false,
  cookie: false,
  allowEIO3: false,
  allowEIO4: true
});

// Connection tracking and user management
const connections = new Map();
let users = [];
let tickets = [];

// Middleware
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    connections: connections.size,
    users: users.length,
    tickets: tickets.length,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// WebSocket connection handler
io.on("connection", (socket) => {
  const clientId = socket.id;
  const clientIp = socket.handshake.address;
  
  // Add to connection tracking
  connections.set(clientId, {
    id: clientId,
    ip: clientIp,
    connectedAt: new Date(),
    lastActivity: new Date()
  });

  // Initialize new user
  users.push({
    id: clientId,
    lat: null,
    lng: null,
    isVisible: true,
    name: "Anonymous",
    role: "user",
    image: ""
  });

  console.log(`🔗 New connection: ${clientId} from ${clientIp}`);

  // Location update handler
  socket.on("user-location", (data) => {
    if (!validateLocationData(data)) {
      return socket.emit("error", { message: "Invalid location data" });
    }
    
    const user = users.find((u) => u.id === clientId);
    if (user) {
      user.lat = data.lat;
      user.lng = data.lng;
      user.role = data.role;
      user.name = data.name || "Anonymous";
      user.isVisible = true;
      user.image = data.image || "";
      connections.get(clientId).lastActivity = new Date();
      
      broadcastUsers();
    }
  });

  // Visibility toggle handler
  socket.on("visibility-change", (isVisible) => {
    const user = users.find((u) => u.id === clientId);
    if (user) {
      user.isVisible = isVisible;
      broadcastUsers();
    }
  });

  // Ticket creation handler
  socket.on("create-ticket", (ticket) => {
    if (validateTicket(ticket)) {
      tickets.push(ticket);
      io.emit("new-ticket", ticket);
      io.emit("all-tickets", tickets);
    } else {
      console.error("Invalid ticket data received:", ticket);
      socket.emit("error", { message: "Invalid ticket data" });
    }
  });

  // Request all tickets
  socket.on("request-tickets", () => {
    socket.emit("all-tickets", tickets);
  });

  // Request all users
  socket.on("request-users", () => {
    socket.emit("nearby-users", getValidUsers());
  });

  // Disconnection handler
  socket.on("disconnect", (reason) => {
    users = users.filter((u) => u.id !== clientId);
    connections.delete(clientId);
    broadcastUsers();
    console.log(` Disconnected: ${clientId} (Reason: ${reason})`);
  });

  // Error handler
  socket.on("error", (err) => {
    console.error(` Socket error (${clientId}):`, err);
    socket.emit("fatal-error", { 
      code: "WS_ERROR", 
      message: "Connection error" 
    });
  });

  // Send initial data to new connection
  socket.emit("all-tickets", tickets);
  socket.emit("nearby-users", getValidUsers());
  socket.on('update-ticket', (data) => {
    // Verify user owns the ticket
    if (tickets[data.id]?.creatorId === socket.id) {
      tickets[data.id].message = data.message;
      io.emit('ticket-updated', tickets[data.id]);
    }
  });
});

// Helper function to get valid users
function getValidUsers() {
  return users.filter(
    (user) =>
      user.isVisible &&
      user.lat !== null &&
      user.lng !== null &&
      user.name !== null &&
      user.role !== null &&
      user.image !== null
  );
}

// Broadcast users to all clients
function broadcastUsers() {
  io.emit("nearby-users", getValidUsers());
}

// Connection monitoring
setInterval(() => {
  const now = new Date();
  connections.forEach((conn, id) => {
    if (now - conn.lastActivity > 300000) { // 5 minutes inactive
      io.to(id).disconnect(true);
      connections.delete(id);
      users = users.filter((u) => u.id !== id);
      console.log(`🕒 Disconnected inactive connection: ${id}`);
      broadcastUsers();
    }
  });
}, 60000); // Run every minute

 
const PORT = process.env.PORT || 443;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
 
  
    Secure server running on port ${PORT}
    SSL Configuration:
  - TLS: v${sslConfig.minVersion}
  - Ciphers: ${sslConfig.ciphers}
  - Active connections: ${connections.size}
  - Tracked users: ${users.length}
  - Active tickets: ${tickets.length}
  `);
});

// Error handling
process.on("uncaughtException", (err) => {
  console.error("  Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(" Unhandled Rejection at:", promise, "reason:", reason);
});

// Validation utilities
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