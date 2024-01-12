const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { instrument } = require("@socket.io/admin-ui");
const bcrypt = require('bcryptjs');
const path = require('path');
const dotenv = require('dotenv');
const envFilePath = path.join(__dirname, 'socket-admin-password.env');
dotenv.config({ path: envFilePath });

async function main() {
    // Express App Configuration
    const app = express();
    app.use(cors());
    app.use(express.static(__dirname));
    app.get('/', (req, res) => {
        res.sendFile(__dirname + '/index.html');
    });

    // HTTP Server Setup
    const server = http.createServer(app);

    // Socket.IO Server Setup
    const io = new Server(server, {
        connectionStateRecovery: {},
        cors: {
            origin: ["https://admin.socket.io", "https://ptcgsim.online/"],
            credentials: true
        }
    });

    // Bcrypt Configuration
    const saltRounds = 10;
    const plainPassword = process.env.ADMIN_PASSWORD || "defaultPassword";
    const hashedPassword = bcrypt.hashSync(plainPassword, saltRounds);

    // Socket.IO Admin Instrumentation
    instrument(io, {
        auth: {
            type: "basic",
            username: "admin",
            password: hashedPassword,
        },
        mode: "development",
    });

    //Socket.IO Connection Handling
    io.on('connection', async (socket) => {
        // Function to handle disconnections (unintended)
        const disconnectHandler = (roomId, username) => {
            socket.to(roomId).emit('userDisconnected', username);
        }
        // Function to handle event emission
        const emitToRoom = (eventName, data) => {
            if (eventName === 'leaveRoom'){
                socket.leave(data.roomId);
                socket.removeListener('disconnect', socket.data.disconnectListener);
            };
            socket.broadcast.to(data.roomId).emit(eventName, data);
        };

        socket.on('joinGame', (roomId, username) => {
            socket.join(roomId);
            const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
            if (clientsInRoom.size < 3){
                socket.data.disconnectListener = () => disconnectHandler(roomId, username);
                socket.emit('joinGame');
                socket.on('disconnect', socket.data.disconnectListener);
            } else {
                socket.leave(roomId);
                socket.emit('roomReject');
            };
        });
        socket.on('userReconnected', (data) => {
            socket.data.disconnectListener = () => disconnectHandler(data.roomId, data.username);
            socket.join(data.roomId);
            socket.on('disconnect', socket.data.disconnectListener);
            io.to(data.roomId).emit('userReconnected', data);
        });

        // List of socket events
        const events = [
            'leaveRoom',
            'requestAction',
            'pushAction',
            'resyncActions',
            'catchUpActions',
            'appendMessage',
            // 'exchangeData',
            // 'loadDeckData',
            // 'reset',
            // 'setup',
            // 'takeTurn',
            // 'draw',
            // 'moveCardBundle',
            // 'shuffleIntoDeck',
            // 'moveToDeckTop',
            // 'switchWithDeckTop',
            // 'viewDeck',
            // 'shuffleAll',
            // 'discardAll',
            // 'lostZoneAll',
            // 'handAll',
            // 'leaveAll',
            // 'discardAndDraw',
            // 'shuffleAndDraw',
            // 'shuffleBottomAndDraw',
            // 'shuffleZone',
            // 'useAbility',
            // 'removeAbilityCounter',
            // 'addDamageCounter',
            // 'updateDamageCounter',
            // 'removeDamageCounter',
            // 'addSpecialCondition',
            // 'updateSpecialCondition',
            // 'removeSpecialCondition',
            // 'discardBoard',
            // 'handBoard',
            // 'shuffleBoard',
            // 'lostZoneBoard',
            'lookAtCards',
            'stopLookingAtCards',
            'revealCards',
            'hideCards',
            'revealShortcut',
            'hideShortcut',
            'lookShortcut',
            'stopLookingShortcut',
            // 'playRandomCardFaceDown',
            // 'rotateCard',
            // 'changeType',
            // 'attack',
            // 'pass',
            // 'VSTARGXFunction',
        ];

        // Register event listeners using the common function
        for (const event of events) {
            socket.on(event, (data) => {
                emitToRoom(event, data);   
            });
        }; 
    });

    // Server Port Configuration
    const port = 4000;
    // Start the server
    server.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}

main();