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
const { instrument } = require("@socket.io/admin-ui");
const io = new Server(server, {
    cors: {
        origin: ["https://admin.socket.io", "https://ptcgsim.online/"],
        credentials: true
    }
});

instrument(io, {
    auth: false,
    // auth: {
    //     type: "basic",
    //     username: "admin",
    //     password: "milon8561"
    // },
    mode: "production",
});

const port = 4000;

io.on('connection', (socket) => {

    socket.on('generateId', () => {
        socket.emit('generateId', socket.id.toString() + '0');
    });
    socket.on('joinGame', (roomId, username) => {
        socket.join(roomId);
        const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
        if (clientsInRoom.size < 3){
            socket.on('disconnect', () => {
                socket.broadcast.to(roomId).emit('leaveGameMessage', username);
                socket.leave(roomId);
            });
            socket.emit('joinGame');
        } else {
            socket.leave(roomId);
            socket.emit('roomReject');
        };
    });
    socket.on('exchangeData', (data) => {
        const clientsInRoom = io.sockets.adapter.rooms.get(data.roomId);
        if (clientsInRoom.size > 1){
            socket.broadcast.to(data.roomId).emit('exchangeData', data);
        } else {
            const errorData = {
                error : 'No other players in room'
            };
            socket.emit('sentData', errorData);
        };
    });
    socket.on('deckData', (data) => {
        socket.broadcast.to(data.roomId).emit('deckData', data);
    });
    socket.on('sentData', (data) => {
        socket.broadcast.to(data.roomId).emit('sentData', data);
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
    socket.on('resetCounters', (data) => {
        socket.broadcast.to(data.roomId).emit('resetCounters', data);
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