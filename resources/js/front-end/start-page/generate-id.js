import { socket } from "../setup/socket.js";

export let roomId;
export let username;

const generateIdButton = document.getElementById('generateIdButton');
const roomIdInput = document.getElementById('roomIdInput');
const copyButton = document.getElementById('copyButton');
const lobby = document.getElementById('lobby');
const joinRoomButton = document.getElementById('joinRoomButton');
const pvpChatbox = document.getElementById('pvpChatbox');
const nameInput = document.getElementById('nameInput');

copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(roomIdInput.value)
});

generateIdButton.addEventListener('click', () => {
    socket.emit('generateId');
});

joinRoomButton.addEventListener('click', () => {
    username = nameInput.value.trim() !== '' ? nameInput.value : 'Anonymous';
    roomId = roomIdInput.value;
    socket.emit('joinGame', roomId, username);
});

socket.on('generateId', (id) => {
    roomIdInput.value = id;
});

socket.on('joinGame', (otherPlayerUsername) => {
    const p = document.createElement('p');
    p.className = 'announcement';
    p.textContent = 'Game joined with id: ' + roomId;
    pvpChatbox.appendChild(p);

    const self = document.createElement('p');
    self.className = 'announcement';
    self.style.backgroundColor = 'green';
    self.textContent = username + ' joined';
    pvpChatbox.appendChild(self);

    if (otherPlayerUsername.length > 0){
        const opp = document.createElement('p');
        opp.className = 'announcement';
        opp.textContent = otherPlayerUsername + ' joined';
        pvpChatbox.appendChild(opp);
    };

    lobby.style.display = 'none';
});

socket.on('joinMessage', (otherPlayerUsername) => {
    const opp = document.createElement('p');
    opp.className = 'announcement';
    opp.textContent = otherPlayerUsername + ' joined';
    pvpChatbox.appendChild(opp);
    pvpChatbox.scrollTop = pvpChatbox.scrollHeight;
});

socket.on('leaveGame', (otherPlayerUsername) => {
    const opp = document.createElement('p');
    opp.className = 'announcement';
    opp.textContent = otherPlayerUsername + ' left';
    pvpChatbox.appendChild(opp);
    pvpChatbox.scrollTop = pvpChatbox.scrollHeight;
});




