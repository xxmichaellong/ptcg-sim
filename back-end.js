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

    socket.on('generateId', () => {
        socket.emit('generateId', socket.id.toString() + '0');
    });

    socket.on('joinGame', (id) => {
        socket.join(id);
        socket.emit('joinGame', id);
    });

    socket.on('drawHand', (id, user, indices) => {
        socket.broadcast.to(id).emit('drawHand', user, indices);
    });
    socket.on('moveCard', (id, user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex) => {
        socket.broadcast.to(id).emit('moveCard', user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex);
    });
    socket.on('shuffleButtonFunction', (id, user, locationAsString, indices) => {
        socket.broadcast.to(id).emit('shuffleButtonFunction', user, locationAsString, indices);
    });
    socket.on('removeStadium', (id, ) => {
        socket.broadcast.to(id).emit('removeStadium');
    });
    socket.on('addDamageCounter', (id, user, location, container, index) => {
        socket.broadcast.to(id).emit('addDamageCounter', user, location, container, index);
    });
    socket.on('updateDamageCounter', (id, user, location, index, textContent) => {
        socket.broadcast.to(id).emit('updateDamageCounter', user, location, index, textContent);
    });
    socket.on('removeDamageCounter', (id, user, location, index) => {
        socket.broadcast.to(id).emit('removeDamageCounter', user, location, index);
    });
    socket.on('addSpecialCondition', (id, user, location, container, index) => {
        socket.broadcast.to(id).emit('addSpecialCondition', user, location, container, index);
    });
    socket.on('updateSpecialCondition', (id, user, location, index, textContent) => {
        socket.broadcast.to(id).emit('updateSpecialCondition', user, location, index, textContent);
    });
    socket.on('removeSpecialCondition', (id, user, location, index) => {
        socket.broadcast.to(id).emit('removeSpecialCondition', user, location, index);
    });
    socket.on('textMessage', (id, textContent) => {
        socket.broadcast.to(id).emit('textMessage', textContent);
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});