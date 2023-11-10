const express = require('express');
const app = express();

//socket.io setup
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const port = 8080;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile( + '/index.html');
});

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
