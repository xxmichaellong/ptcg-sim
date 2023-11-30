import { socket } from "../setup/socket.js";

export let roomId;
export let username;

const generateIdButton = document.getElementById('generateIdButton');
const roomIdInput = document.getElementById('roomIdInput');
const copyButton = document.getElementById('copyButton');
const coverPage = document.getElementById('coverPage');
const playButton = document.getElementById('playButton');
const chatbox = document.getElementById('chatbox');
const nameInput = document.getElementById('nameInput');

copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(roomIdInput.value)
});

generateIdButton.addEventListener('click', () => {
    socket.emit('generateId');
});

playButton.addEventListener('click', () => {
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
    chatbox.appendChild(p);

    const self = document.createElement('p');
    self.className = 'announcement';
    self.style.backgroundColor = 'green';
    self.textContent = username + ' joined';
    chatbox.appendChild(self);

    if (otherPlayerUsername.length > 0){
        const opp = document.createElement('p');
        opp.className = 'announcement';
        opp.textContent = otherPlayerUsername + ' joined';
        chatbox.appendChild(opp);
    };

    coverPage.style.display = 'none';
});

socket.on('joinMessage', (otherPlayerUsername) => {
    const opp = document.createElement('p');
    opp.className = 'announcement';
    opp.textContent = otherPlayerUsername + ' joined';
    chatbox.appendChild(opp);
    chatbox.scrollTop = chatbox.scrollHeight;
});

socket.on('leaveGame', (otherPlayerUsername) => {
    const opp = document.createElement('p');
    opp.className = 'announcement';
    opp.textContent = otherPlayerUsername + ' left';
    chatbox.appendChild(opp);
    chatbox.scrollTop = chatbox.scrollHeight;
});




