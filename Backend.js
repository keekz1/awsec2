const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://www.wesynchro.com"
    ],
    methods: ["GET", "POST"],
  },
});

app.use(cors());

const PORT = process.env.PORT || 80;
let users = [];

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Initialize user with visible: true
  users.push({
    id: socket.id,
    lat: null,
    lng: null,
    isVisible: true,
    name: 'Anonymous', // Default name
    role: 'user' // Set default role, you can adjust this logic as needed

  });

  socket.on("user-location", (data) => {
    if (!data?.lat || !data?.lng || !data?.role) return;

    const user = users.find(u => u.id === socket.id);
    if (user) {
      user.lat = data.lat;
      user.lng = data.lng;
      user.role = data.role;  // Update the user's role
      user.name = data.name; // Update name
      user.isVisible = true;  // Ensure the user is visible when location updates
      broadcastUsers();
    }
  });


  socket.on("visibility-change", (isVisible) => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      user.isVisible = isVisible;
      broadcastUsers();
    }
  });

  socket.on("disconnect", () => {
    users = users.filter(u => u.id !== socket.id);
    broadcastUsers();
    console.log(`User disconnected: ${socket.id}`);
  });


  function broadcastUsers() {
    // Filter valid visible users with valid lat, lng, and role
    const validUsers = users.filter(user => 
      user.isVisible && 
      user.lat !== null && 
      user.lng !== null &&
      user.name !== null &&// Ensure name is not null
      user.role !== null  // Ensure role is not null
    );
    
    io.emit("nearby-users", validUsers);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});