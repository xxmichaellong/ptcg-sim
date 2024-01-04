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

require('dotenv').config();
const bcrypt = require('bcryptjs');
const saltRounds = 10;
const plainPassword = process.env.ADMIN_PASSWORD || "defaultPassword";
const hashedPassword = bcrypt.hashSync(plainPassword, saltRounds);

instrument(io, {
    auth: {
        type: "basic",
        username: "admin",
        password: hashedPassword,
    },
    mode: "development",
});

const port = 4000;

io.on('connection', (socket) => {
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

    // Define a function to handle event emission
    const emitToRoom = (eventName, data) => {
        socket.broadcast.to(data.roomId).emit(eventName, data);
    };
    // List of events
    const events = [
        'deckData',
        'sentData',
        'appendMessage',
        'reset',
        'takeTurn',
        'VSTARGXFunction',
        'moveCard',
        'addDamageCounter',
        'updateDamageCounter',
        'removeDamageCounter',
        'addSpecialCondition',
        'updateSpecialCondition',
        'removeSpecialCondition',
        'addAbilityCounter',
        'removeAbilityCounter',
        'resetCounters',
        'shuffleZone',
        'viewDeck',
        'rotateCard',
        'revealShortcut',
        'hideShortcut',
        'stopLookingShortcut',
        'faceDown',
        'changeType'
    ];
    // Register event listeners using the common function
    for (const event of events) {
        socket.on(event, (data) => {
            emitToRoom(event, data);
        });
    };

});

// Start the server
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});