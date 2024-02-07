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

    const roomInfo = new Map();
    // Function to periodically clean up empty rooms
    const cleanUpEmptyRooms = () => {
        roomInfo.forEach((room, roomId) => {
            if (room.players.size === 0 && room.spectators.size === 0) {
                roomInfo.delete(roomId);
            };
        });
    }
    // Set up a timer to clean up empty rooms every 5 minutes (adjust as needed)
    setInterval(cleanUpEmptyRooms, 5 * 60 * 1000);
    //Socket.IO Connection Handling
    io.on('connection', async (socket) => {
        // Function to handle disconnections (unintended)
        const disconnectHandler = (roomId, username) => {
            if (!socket.data.leaveRoom){
                socket.to(roomId).emit('userDisconnected', username);
            };
        
            // Remove the disconnected user from the roomInfo map
            if (roomInfo.has(roomId)) {
                const room = roomInfo.get(roomId);
        
                if (room.players.has(username)) {
                    room.players.delete(username);
                } else if (room.spectators.has(username)) {
                    room.spectators.delete(username);
                };
        
                // If both players and spectators are empty, remove the roomInfo entry
                if (room.players.size === 0 && room.spectators.size === 0) {
                    roomInfo.delete(roomId);
                };
            };
        };        
        // Function to handle event emission
        const emitToRoom = (eventName, data) => {
            socket.broadcast.to(data.roomId).emit(eventName, data);
            if (eventName === 'leaveRoom'){
                socket.leave(data.roomId);
                if (socket.data.disconnectListener){
                    socket.data.leaveRoom = true;
                    socket.data.disconnectListener();
                    socket.removeListener('disconnect', socket.data.disconnectListener);
                    socket.data.leaveRoom = false;
                };
            };
        };

        socket.on('joinGame', (roomId, username, isSpectator) => {
            if (!roomInfo.has(roomId)) {
                roomInfo.set(roomId, { players: new Set(), spectators: new Set() });
            };
            const room = roomInfo.get(roomId);
        
            if (room.players.size < 2 || isSpectator) {
                socket.join(roomId);
                // Check if the user is a spectator or there are fewer than 2 players
                if (isSpectator) {
                    room.spectators.add(username);
                    socket.emit('spectatorJoin');
                } else {
                    room.players.add(username);
                    socket.emit('joinGame');
                    socket.data.disconnectListener = () => disconnectHandler(roomId, username);
                    socket.on('disconnect', socket.data.disconnectListener);
                };
            } else {
                socket.emit('roomReject');
            };
        });

        socket.on('userReconnected', (data) => {
            if (!roomInfo.has(data.roomId)) {
                roomInfo.set(data.roomId, { players: new Set(), spectators: new Set() });
            };
            const room = roomInfo.get(data.roomId);
            socket.join(data.roomId);
            if (!data.notSpectator) {
                room.spectators.add(data.username);
            } else {
                room.players.add(data.username);
                socket.data.disconnectListener = () => disconnectHandler(data.roomId, data.username);
                socket.on('disconnect', socket.data.disconnectListener);
                io.to(data.roomId).emit('userReconnected', data);
            };
        });

        // List of socket events
        const events = [
            'leaveRoom',
            'requestAction',
            'pushAction',
            'resyncActions',
            'catchUpActions',
            'syncCheck',
            'appendMessage',
            'spectatorActionData',
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