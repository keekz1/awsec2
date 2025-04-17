const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: [
      "https://synchro-kappa.vercel.app",
      "https://www.wesynchro.com",
      "http://localhost:3000",
      "http://18.175.220.231"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  // Updated transport settings:
  transports: ["websocket", "polling"],
  allowUpgrades: true,
  perMessageDeflate: false, // Disable compression for debugging
  // Timeout settings:
  pingTimeout: 30000,  // Reduced from 60000
  pingInterval: 10000, // Reduced from 25000
  // Protocol settings:
  allowEIO3: true,
  allowEIO4: true,  // Explicitly enable v4
  // Security:
  cookie: false,
  serveClient: false,
  // New important settings:
  connectTimeout: 5000,
  maxHttpBufferSize: 1e8  // 100MB max payload
});
app.use(cors());
app.use(express.json()); // Add this line to parse JSON request bodies

const PORT = process.env.PORT || 80;
let users = [];
let tickets = []; // Array to store tickets

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
    // Basic validation to ensure all required fields are present
    if (
      ticket &&
      ticket.id &&
      ticket.lat &&
      ticket.lng &&
      ticket.message &&
      ticket.creatorId &&
      ticket.creatorName
    ) {
      tickets.push(ticket); // Add the ticket to the tickets array
      io.emit("new-ticket", ticket); // Notify all clients about the new ticket
      io.emit("all-tickets", tickets); // Notify all clients with the updated ticket list.
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
    io.emit("all-tickets", tickets); // Send all tickets to newly connected clients
  }

  broadcastUsers(); // Send initial users and tickets list
});

server.listen(80, "0.0.0.0", () => {  // Explicitly listen on all interfaces
  console.log("Server running on port 80");
});