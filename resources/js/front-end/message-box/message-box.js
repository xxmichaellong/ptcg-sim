import { roomId } from "../front-end.js";
import { socket } from "../setup/socket.js";

const chatbox = document.getElementById('chatbox');
const messageInput = document.getElementById('messageInput');

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const p = document.createElement('p');
        p.className = 'selfBubble';
        p.textContent = messageInput.value;
        chatbox.appendChild(p);
        messageInput.value = '';
        chatbox.scrollTop = chatbox.scrollHeight;

        socket.emit('textMessage', roomId, p.textContent);
    };
});

socket.on('textMessage', (textContent) => {
    const p = document.createElement('p');
    p.className = 'oppBubble';
    p.textContent = textContent;
    chatbox.appendChild(p);
    chatbox.scrollTop = chatbox.scrollHeight;
});

socket.on('generalMessage', (textContent) => {
    const p = document.createElement('p');
    p.className = 'announcement';
    p.textContent = textContent;
    p.style.background = 'grey';
    chatbox.appendChild(p);
    chatbox.scrollTop = chatbox.scrollHeight;
});
