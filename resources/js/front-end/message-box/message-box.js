import { roomId } from "../front-end.js";
import { socket } from "../setup/socket.js";

export const pvpChatbox = document.getElementById('pvpChatbox');
const pvpMessageInput = document.getElementById('pvpMessageInput');

pvpMessageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter'){
        const p = document.createElement('p');
        p.className = 'selfBubble';
        p.textContent = pvpMessageInput.value;
        pvpChatbox.appendChild(p);
        pvpMessageInput.value = '';
        pvpChatbox.scrollTop = pvpChatbox.scrollHeight;

        socket.emit('textMessage', roomId, p.textContent);
    };
});

socket.on('textMessage', (textContent) => {
    const p = document.createElement('p');
    p.className = 'oppBubble';
    p.textContent = textContent;
    pvpChatbox.appendChild(p);
    pvpChatbox.scrollTop = pvpChatbox.scrollHeight;
});

socket.on('generalMessage', (textContent) => {
    const p = document.createElement('p');
    p.className = 'announcement';
    p.textContent = textContent;
    p.style.background = 'grey';
    pvpChatbox.appendChild(p);
    pvpChatbox.scrollTop = pvpChatbox.scrollHeight;
});
