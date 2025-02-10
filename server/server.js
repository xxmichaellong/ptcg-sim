import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import { instrument } from '@socket.io/admin-ui';
import bcrypt from 'bcryptjs';
import path from 'path';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Handle __dirname in ES modules and adjust for client folder
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.join(__dirname, '../client');

const envFilePath = path.join(__dirname, 'socket-admin-password.env');
dotenv.config({ path: envFilePath });

function generateRandomKey(length) {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    key += characters.charAt(randomIndex);
  }
  return key;
}

async function main() {
  const app = express();
  // HTTP Server Setup
  const server = http.createServer(app);

  // Socket.IO Server Setup
  const io = new Server(server, {
    connectionStateRecovery: {},
    cors: {
      origin: ['https://admin.socket.io', 'https://ptcgsim.online/'],
      credentials: true,
    },
  });
  // Create a new SQLite database
  const dbFilePath = 'database/db.sqlite';
  const maxSizeGB = 15;
  const db = new sqlite3.Database(dbFilePath);
  let isDatabaseCapacityReached = false;

  // Check database size
  const checkDatabaseSizeGB = () => {
    const stats = fs.statSync(dbFilePath);
    const fileSizeInBytes = stats.size;
    const fileSizeInGB = fileSizeInBytes / (1024 * 1024 * 1024); // Convert bytes to gigabytes
    return fileSizeInGB;
  };

  // Perform size check periodically
  setInterval(
    () => {
      const currentSize = checkDatabaseSizeGB();
      if (currentSize > maxSizeGB) {
        isDatabaseCapacityReached = true;
      }
    },
    1000 * 60 * 60
  );

  // Create a table to store key-value pairs
  db.serialize(() => {
    db.run(
      'CREATE TABLE IF NOT EXISTS KeyValuePairs (key TEXT PRIMARY KEY, value TEXT)'
    );
  });

  // Bcrypt Configuration
  const saltRounds = 10;
  const plainPassword = process.env.ADMIN_PASSWORD || 'defaultPassword';
  const hashedPassword = bcrypt.hashSync(plainPassword, saltRounds);

  // Socket.IO Admin Instrumentation
  instrument(io, {
    auth: {
      type: 'basic',
      username: 'admin',
      password: hashedPassword,
    },
    mode: 'development',
  });

  app.set('view engine', 'ejs');
  app.set('views', clientDir);
  app.use(cors());
  app.use(express.static(clientDir));
  app.get('/', (_, res) => {
    res.render('index', { importDataJSON: null });
  });
  app.get('/import', (req, res) => {
    const key = req.query.key;
    if (!key) {
      return res.status(400).json({ error: 'Key parameter is missing' });
    }

    db.get(
      'SELECT value FROM KeyValuePairs WHERE key = ?',
      [key],
      (err, row) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        if (row) {
          res.render('index', { importDataJSON: row.value });
        } else {
          res.status(404).json({ error: 'Key not found' });
        }
      }
    );
  });

  const roomInfo = new Map();
  // Function to periodically clean up empty rooms
  const cleanUpEmptyRooms = () => {
    roomInfo.forEach((room, roomId) => {
      if (room.players.size === 0 && room.spectators.size === 0) {
        roomInfo.delete(roomId);
      }
    });
  };
  // Set up a timer to clean up empty rooms every 5 minutes (adjust as needed)
  setInterval(cleanUpEmptyRooms, 5 * 60 * 1000);
  //Socket.IO Connection Handling
  io.on('connection', async (socket) => {
    // Function to handle disconnections (unintended)
    const disconnectHandler = (roomId, username) => {
      if (!socket.data.leaveRoom) {
        socket.to(roomId).emit('userDisconnected', username);
      }
      // Remove the disconnected user from the roomInfo map
      if (roomInfo.has(roomId)) {
        const room = roomInfo.get(roomId);

        if (room.players.has(username)) {
          room.players.delete(username);
        } else if (room.spectators.has(username)) {
          room.spectators.delete(username);
        }

        // If both players and spectators are empty, remove the roomInfo entry
        if (room.players.size === 0 && room.spectators.size === 0) {
          roomInfo.delete(roomId);
        }
      }
    };
    // Function to handle event emission
    const emitToRoom = (eventName, data) => {
      socket.broadcast.to(data.roomId).emit(eventName, data);
      if (eventName === 'leaveRoom') {
        socket.leave(data.roomId);
        if (socket.data.disconnectListener) {
          socket.data.leaveRoom = true;
          socket.data.disconnectListener();
          socket.removeListener('disconnect', socket.data.disconnectListener);
          socket.data.leaveRoom = false;
        }
      }
    };
    socket.on('storeGameState', (exportData) => {
      if (isDatabaseCapacityReached) {
        socket.emit(
          'exportGameStateFailed',
          'No more storage for game states! You should probably tell Michael/Xiao Xiao.'
        );
      } else {
        const key = generateRandomKey(4);
        db.run(
          'INSERT OR REPLACE INTO KeyValuePairs (key, value) VALUES (?, ?)',
          [key, exportData],
          (err) => {
            if (err) {
              socket.emit(
                'exportGameStateFailed',
                'Error exporting game! Please try again or save as a file.'
              );
            } else {
              socket.emit('exportGameStateSuccessful', key);
            }
          }
        );
      }
    });
    socket.on('joinGame', (roomId, username, isSpectator) => {
      if (!roomInfo.has(roomId)) {
        roomInfo.set(roomId, { players: new Set(), spectators: new Set() });
      }
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
          socket.data.disconnectListener = () =>
            disconnectHandler(roomId, username);
          socket.on('disconnect', socket.data.disconnectListener);
        }
      } else {
        socket.emit('roomReject');
      }
    });

    socket.on('userReconnected', (data) => {
      if (!roomInfo.has(data.roomId)) {
        roomInfo.set(data.roomId, {
          players: new Set(),
          spectators: new Set(),
        });
      }
      const room = roomInfo.get(data.roomId);
      socket.join(data.roomId);
      if (!data.notSpectator) {
        room.spectators.add(data.username);
      } else {
        room.players.add(data.username);
        socket.data.disconnectListener = () =>
          disconnectHandler(data.roomId, data.username);
        socket.on('disconnect', socket.data.disconnectListener);
        io.to(data.roomId).emit('userReconnected', data);
      }
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
      'initiateImport',
      'endImport',
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
    }
  });

  const port = 4000;
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server is running at http://localhost:${port}`);
  });
}
main();
