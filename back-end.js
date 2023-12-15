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

    socket.on('setup', (data) => {
        socket.broadcast.to(data.roomId).emit('setup', data);
    });
    socket.on('reset', (data) => {
        socket.broadcast.to(data.roomId).emit('reset', data);
    });
    socket.on('takeTurn', (data) => {
        socket.broadcast.to(data.roomId).emit('takeTurn', data);
    });
    socket.on('flipCoin', (data) => {
        socket.broadcast.to(data.roomId).emit('flipCoin', data);
    })
    socket.on('VSTARGXFunction', (data) => {
        socket.broadcast.to(data.roomId).emit('VSTARGXFunction', data);
    })
    socket.on('appendMessage', (data) => {
        socket.broadcast.to(data.roomId).emit('appendMessage', data);
    });




    socket.on('moveCard', (id, user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex) => {
        socket.broadcast.to(id).emit('moveCard', user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex);
    });
    socket.on('shuffleContainer', (id, user, location, location_html, indices) => {
        socket.broadcast.to(id).emit('shuffleContainer', user, location, location_html, indices);
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
    socket.on('viewDeck', (id, user, viewAmount, targetOpp, top, deckCount) => {
        socket.broadcast.to(id).emit('viewDeck', user, viewAmount, targetOpp, top, deckCount);
    });
    socket.on('discardAll', (id, user, discardAmount) => {
        socket.broadcast.to(id).emit('discardAll', user, discardAmount);
    });
});

// Start the server
server.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});