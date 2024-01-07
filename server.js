const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { instrument } = require("@socket.io/admin-ui");
const bcrypt = require('bcryptjs');
require('dotenv').config();

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

    // // SQLite Database Setup
    // const db = await open({
    //     filename: 'chat.db',
    //     driver: sqlite3.Database
    // });

    // // Database Table Creation
    // await db.exec('DROP TABLE IF EXISTS events;');
    // await db.exec(`
    //     CREATE TABLE IF NOT EXISTS events (
    //         id INTEGER PRIMARY KEY AUTOINCREMENT,
    //         data TEXT,
    //         event TEXT,
    //         roomId TEXT
    //     );
    // `);

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

    //keep a record of all of the room counters
    const turnCounter = {};

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
            //initialize turn counter
            if (!turnCounter[roomId]){
                turnCounter[roomId] = { turn: 0 }
            };
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
            'exchangeData',
            'deckData',
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
            'changeType',
            'leaveRoom'
        ];

        // Register event listeners using the common function
        for (const event of events) {
            socket.on(event, (data) => {
                emitToRoom(event, data);   
            });
            // socket.on(event, async (data) => {
            //     let result;
            //     try {
            //         // Store the event in the database
            //         result = await db.run('INSERT INTO events (data, event, roomId) VALUES (?, ?, ?)',
            //             [JSON.stringify(data), event, data.roomId]
            //         );
            //     } catch (e) {
            //         console.error('Database error:', e);
            //         return;
            //     }          
            //     // Include the offset with the message
            //     emitToRoom(event, data, result.lastID);   
            // });
        };        

        // if (!socket.recovered) {
        //     // if the connection state recovery was not successful
        //     try {
        //         await db.each(
        //             'SELECT id, data, event FROM events WHERE id > :serverOffset AND roomId = :roomId',
        //             {
        //                 ':serverOffset': socket.handshake.auth.serverOffset || 0,
        //                 ':roomId': socket.data.roomId
        //             },
        //             (_err, row) => {
        //                 console.log('hi')
        //                 // emit recovered messages with event information
        //                 socket.emit(row.event, JSON.parse(row.data)); // Parse JSON string to an object
        //             }
        //         );
        //     } catch (e) {
        //         // something went wrong
        //     }
        // };        
    });

    // Server Port Configuration
    const port = 4000;
    // Start the server
    server.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}

main();