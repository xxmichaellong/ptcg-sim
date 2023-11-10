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
  res.sendFile(__dirname + '/index.html');
});

const backEndPlayers = {};

io.on('connection', (socket) => {
  console.log('a user connected');

  // Listen for the 'appendImage' event from the client
  socket.on('appendImage', (imageAttributes) => {
    // Broadcast the image information to all connected clients
    socket.broadcast.emit('imageAppended', imageAttributes);
  });

  /*
  backEndPlayers[socket.id] = {
    x: 100,
    y: 100
  };

  io.emit('updatePlayers', backEndPlayers);

  socket.on('disconnect', (reason) => {
    console.log(reason);
    delete backEndPlayers[socket.id]
    io.emit('updatePlayers', backEndPlayers)
  }); 
  console.log(backEndPlayers);
  */
});

// Start the server
server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
