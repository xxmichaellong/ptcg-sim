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

const players = new Map();

io.on('connection', (socket) => {

    socket.on('generateId', () => {
        socket.emit('generateId', socket.id.toString() + '0');
    });

    socket.on('joinGame', (id, username) => {
        socket.join(id);
        players.set(socket.id, { id, username });

        const otherPlayerInfo = Array.from(players.entries())
            .filter(([key, player]) => key !== socket.id && player.id === id);

        const otherPlayerUsername = otherPlayerInfo.map(([_, player]) => player.username);

        socket.emit('joinGame', otherPlayerUsername);
        socket.broadcast.to(id).emit('joinMessage', username);

        socket.on('disconnect', () => {
            players.delete(socket.id);
            socket.broadcast.to(id).emit('leaveGame', username);
        });
    });

    socket.on('drawHand', (id, user, indices) => {
        socket.broadcast.to(id).emit('drawHand', user, indices);
    });
    socket.on('moveCard', (id, user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex) => {
        socket.broadcast.to(id).emit('moveCard', user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex);
    });
    socket.on('shuffleButtonFunction', (id, user, location, location_html, indices) => {
        socket.broadcast.to(id).emit('shuffleButtonFunction', user, location, location_html, indices);
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
    socket.on('generalMessage', (id, textContent) => {
        socket.broadcast.to(id).emit('generalMessage', textContent);
    });
    socket.on('discardAndDraw', (id, discardAmount, drawAmount) => {
        socket.broadcast.to(id).emit('discardAndDraw', discardAmount, drawAmount);
    });
    socket.on('shuffleAndDraw', (id, shuffleAmount, drawAmount, indices) => {
        socket.broadcast.to(id).emit('shuffleAndDraw', shuffleAmount, drawAmount, indices);
    });
    socket.on('shuffleBottomAndDraw', (id, shuffleAmount, drawAmount, indices) => {
        socket.broadcast.to(id).emit('shuffleBottomAndDraw', shuffleAmount, drawAmount, indices);
    });
    socket.on('draw', (id, drawAmount) => {
        socket.broadcast.to(id).emit('draw', drawAmount);
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});