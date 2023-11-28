const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());

//socket.io setup
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {cors: {}});

const port = 4000;

io.on('connection', (socket) => {
    console.log('a user connected');
    // Listen for the 'appendImage' event from the client
    socket.on('drawHand', (user, indices) => {
        socket.broadcast.emit('drawHand', user, indices);
    });
    socket.on('moveCard', (user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex) => {
        socket.broadcast.emit('moveCard', user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex);
    });
    socket.on('shuffleButtonFunction', (user, locationAsString, indices) => {
        socket.broadcast.emit('shuffleButtonFunction', user, locationAsString, indices);
    });
    socket.on('removeStadium', () => {
        socket.broadcast.emit('removeStadium');
    });
    socket.on('addDamageCounter', (user, location, container, index) => {
        socket.broadcast.emit('addDamageCounter', user, location, container, index);
    });
    socket.on('updateDamageCounter', (user, location, index, textContent) => {
        socket.broadcast.emit('updateDamageCounter', user, location, index, textContent);
    });
    socket.on('removeDamageCounter', (user, location, index) => {
        socket.broadcast.emit('removeDamageCounter', user, location, index);
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});