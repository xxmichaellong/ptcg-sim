import { socket } from "../setup/socket.js";

export let roomId;

const generateIdButton = document.getElementById('generateIdButton');
const roomIdInput = document.getElementById('roomIdInput');
const copyButton = document.getElementById('copyButton');
const coverPage = document.getElementById('coverPage');
const playButton = document.getElementById('playButton');
const chatbox = document.getElementById('chatbox');

copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(roomIdInput.value)
});

generateIdButton.addEventListener('click', () => {
    socket.emit('generateId');
});

playButton.addEventListener('click', () => {
    roomId = roomIdInput.value;
    socket.emit('joinGame', roomId);
});

socket.on('generateId', (id) => {
    roomIdInput.value = id;
});

socket.on('joinGame', (id) => {
    const p = document.createElement('p');
    p.className = 'announcement';
    p.textContent = 'Game created with ID: ' + id;
    chatbox.appendChild(p);
    coverPage.style.display = 'none';
});




