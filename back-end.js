const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile( + '/index.html');
});

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

        const otherPlayerUsernames = otherPlayerInfo.map(([_, player]) => player.username);

        if (otherPlayerUsernames.length < 2){
            socket.emit('joinGame', otherPlayerUsernames);
            socket.broadcast.to(id).emit('joinMessage', username);
    
            socket.on('disconnect', () => {
                players.delete(socket.id);
                socket.broadcast.to(id).emit('leaveGameMessage', username);
            });
        } else {
            socket.emit('roomReject');
        };
    });
    socket.on('appendMessage', (data) => {
        socket.broadcast.to(data.roomId).emit('appendMessage', data);
    });
    socket.on('reset', (data) => {
        socket.broadcast.to(data.roomId).emit('reset', data);
    });
    socket.on('takeTurn', (data) => {
        socket.broadcast.to(data.roomId).emit('takeTurn', data);
    });
    socket.on('VSTARGXFunction', (data) => {
        socket.broadcast.to(data.roomId).emit('VSTARGXFunction', data);
    })
    socket.on('moveCard', (data) => {
        socket.broadcast.to(data.roomId).emit('moveCard', data);
    });
    socket.on('addDamageCounter', (data) => {
        socket.broadcast.to(data.roomId).emit('addDamageCounter', data);
    });
    socket.on('updateDamageCounter', (data) => {
        socket.broadcast.to(data.roomId).emit('updateDamageCounter', data);
    });
    socket.on('removeDamageCounter', (data) => {
        socket.broadcast.to(data.roomId).emit('removeDamageCounter', data);
    });
    socket.on('addSpecialCondition', (data) => {
        socket.broadcast.to(data.roomId).emit('addSpecialCondition', data);
    });
    socket.on('updateSpecialCondition', (data) => {
        socket.broadcast.to(data.roomId).emit('updateSpecialCondition', data);
    });
    socket.on('removeSpecialCondition', (data) => {
        socket.broadcast.to(data.roomId).emit('removeSpecialCondition', data);
    });
    socket.on('addAbilityCounter', (data) => {
        socket.broadcast.to(data.roomId).emit('addAbilityCounter', data);
    });
    socket.on('removeAbilityCounter', (data) => {
        socket.broadcast.to(data.roomId).emit('removeAbilityCounter', data);
    });
    socket.on('shuffleContainer', (data) => {
        socket.broadcast.to(data.roomId).emit('shuffleContainer', data);
    });
    socket.on('viewDeck', (data) => {
        socket.broadcast.to(data.roomId).emit('viewDeck', data);
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});