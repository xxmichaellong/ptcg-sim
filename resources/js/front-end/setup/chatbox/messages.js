import { chatbox, p1, p2Chatbox, roomId, socket } from '../../front-end.js';

export const appendMessage = (user, message, type, received = false) => {
    const p = document.createElement('p');
    p.className = type;
    p.textContent = message;
    const chat = p1[0] ? chatbox : p2Chatbox;
    chat.appendChild(p);
    chat.scrollTop = chat.scrollHeight;
    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            message: message,
            type : type,
            received : true
        };
        socket.emit('appendMessage', data);
    };
}