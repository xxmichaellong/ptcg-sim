const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());

//socket.io setup
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: "http://localhost:8000",  // specify the client origin
    methods: ["GET", "POST"]  // specify the allowed HTTP methods
  }
});

const port = 4000;

io.on('connection', (socket) => {
  console.log('a user connected');

  // Listen for the 'appendImage' event from the client
  socket.on('appendImage', (imageAttributes, targetContainerId) => {
    // Broadcast the image information to all connected clients
    socket.broadcast.emit('imageAppended', imageAttributes, targetContainerId);
  });

  // Listen for the 'removeImage' event from the client
   socket.on('removeImage', (imageId, targetContainerId) => {
    // Broadcast the image information to all connected clients
    socket.broadcast.emit('imageRemoved', imageId, targetContainerId);
  });
});

// Start the server
server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});