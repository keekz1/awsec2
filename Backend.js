const express = require("express");
const fs = require("fs");
const https = require("https");
const socketIo = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");

// Environment variables setup
require("dotenv").config();

const app = express();

// 🔒 Enhanced Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.wesynchro.com", "wss://api.wesynchro.com"]
    }
  },
  hsts: {
    maxAge: 63072000, // 2 years
    includeSubDomains: true,
    preload: true
  }
}));

// 🌐 CORS Configuration
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

// 📜 SSL Configuration
const sslConfig = {
  key: fs.readFileSync(process.env.SSL_KEY_PATH || "/etc/letsencrypt/live/api.wesynchro.com/privkey.pem"),
  cert: fs.readFileSync(process.env.SSL_CERT_PATH || "/etc/letsencrypt/live/api.wesynchro.com/fullchain.pem"),
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

// 🔌 WebSocket Server Configuration
const io = socketIo(server, {
  cors: corsOptions,
  transports: ["websocket"], // Force WebSocket only
  allowUpgrades: false, // Disable protocol upgrades
  perMessageDeflate: {
    threshold: 1024,
    memLevel: 6,
    clientNoContextTakeover: true,
    serverNoContextTakeover: true
  },
  pingTimeout: 30000, // 30 seconds
  pingInterval: 25000, // 25 seconds
  maxHttpBufferSize: 1e6, // 1MB
  connectTimeout: 10000, // 10 seconds
  path: "/socket.io",
  serveClient: false,
  cookie: {
    name: "io",
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true
  }
});

// Connection tracking
const connections = new Map();

// 🛠️ Middleware
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    connections: connections.size,
    uptime: process.uptime()
  });
});

// WebSocket connection handler
io.on("connection", (socket) => {
  const clientId = socket.id;
  connections.set(clientId, {
    id: clientId,
    connectedAt: new Date(),
    lastActivity: new Date()
  });

  console.log(`🔗 New connection: ${clientId} (Total: ${connections.size})`);

  // Event handlers
  socket.on("user-location", (data) => {
    if (!validateLocationData(data)) {
      return socket.emit("error", "Invalid location data");
    }
    
    connections.get(clientId).lastActivity = new Date();
    // ... your existing location handling logic
  });

  socket.on("disconnect", (reason) => {
    connections.delete(clientId);
    console.log(`❌ Disconnected: ${clientId} (Reason: ${reason})`);
  });

  socket.on("error", (err) => {
    console.error(`🚨 Socket error (${clientId}):`, err.message);
  });
});

// Connection monitoring
setInterval(() => {
  const now = new Date();
  connections.forEach((connection, id) => {
    if (now - connection.lastActivity > 300000) { // 5 minutes inactive
      io.to(id).disconnect(true);
      connections.delete(id);
    }
  });
}, 60000); // Check every minute

// 🚀 Server Startup
const PORT = process.env.PORT || 443;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗ 
  ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
  ███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
  ╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
  ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
  ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
  
  ✅ Secure server running on port ${PORT}
  🔐 SSL Configuration:
  - TLS: v${sslConfig.minVersion}
  - Ciphers: ${sslConfig.ciphers}
  - Connections: ${connections.size}
  `);
});

// Error handling
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Validation utilities (remain the same)
function validateLocationData(data) { /* ... */ }
function validateTicket(ticket) { /* ... */ }
function updateUser(user, data) { /* ... */ }