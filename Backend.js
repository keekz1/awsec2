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
  key: fs.readFileSync('/etc/letsencrypt/live/api.wesynchro.com/privkey.pem'),
  cert: fs.readFileSync('/etc/letsencrypt/live/api.wesynchro.com/fullchain.pem'), // This already includes the chain
  // Remove the 'ca' property completely since fullchain.pem contains everything
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
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// WebSocket connection handler
io.on("connection", (socket) => {
  const clientId = socket.id;
  const clientIp = socket.handshake.address;
  
  connections.set(clientId, {
    id: clientId,
    ip: clientIp,
    connectedAt: new Date(),
    lastActivity: new Date()
  });

  console.log(`🔗 New connection: ${clientId} from ${clientIp}`);

  // Event handlers
  socket.on("user-location", (data) => {
    if (!validateLocationData(data)) {
      return socket.emit("error", { message: "Invalid location data" });
    }
    
    connections.get(clientId).lastActivity = new Date();
    // ... your business logic
  });

  socket.on("disconnect", (reason) => {
    connections.delete(clientId);
    console.log(`❌ Disconnected: ${clientId} (Reason: ${reason})`);
  });

  socket.on("error", (err) => {
    console.error(`🚨 Socket error (${clientId}):`, err);
    socket.emit("fatal-error", { 
      code: "WS_ERROR", 
      message: "Connection error" 
    });
  });
});

// Connection monitoring
setInterval(() => {
  const now = new Date();
  connections.forEach((conn, id) => {
    if (now - conn.lastActivity > 300000) { // 5 minutes inactive
      io.to(id).disconnect(true);
      connections.delete(id);
      console.log(`🕒 Disconnected inactive connection: ${id}`);
    }
  });
}, 60000); // Run every minute

// 🚀 Server Startup
const PORT = process.env.PORT || 443;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
  ██████╗ ███████╗███████╗██████╗ ██╗   ██╗
  ██╔══██╗██╔════╝██╔════╝██╔══██╗╚██╗ ██╔╝
  ██████╔╝█████╗  █████╗  ██████╔╝ ╚████╔╝ 
  ██╔══██╗██╔══╝  ██╔══╝  ██╔══██╗  ╚██╔╝  
  ██║  ██║███████╗███████╗██║  ██║   ██║   
  ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝   
  
  ✅ Secure server running on port ${PORT}
  🔐 SSL Configuration:
  - TLS: v${sslConfig.minVersion}
  - Ciphers: ${sslConfig.ciphers}
  - Connections: ${connections.size}
  `);
});

// Error handling
process.on("uncaughtException", (err) => {
  console.error("🆘 Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ Unhandled Rejection at:", promise, "reason:", reason);
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