const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: ["https://synchro-kappa.vercel.app",           "https://localhost:3000", "https://www.wesynchro.com"
    ],
          

    methods: ["GET", "POST"],
  },
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

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});