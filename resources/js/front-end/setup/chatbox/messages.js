import { chatbox, p1, p2Chatbox, roomId, socket } from '../../front-end.js';

export const appendMessage = (user, message, type, received = false) => {
    const p = document.createElement('p');
    if (type === 'player'){
        p.className = user === 'self' ? 'self-text' : 'opp-text';
    } else if (type === 'message'){
        p.className = user === 'self' ? 'self-message' : 'opp-message';
    } else {
        p.className = type;
    };
    p.textContent = message;
    const chat = p1[0] ? chatbox : p2Chatbox;
    chat.appendChild(p);
    chat.scrollTop = chat.scrollHeight;
    if (!p1[0] && !received){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : roomId,
            user: oUser,
            message: message,
            type : type,
            received : true
        };
        socket.emit('appendMessage', data);
    };
}