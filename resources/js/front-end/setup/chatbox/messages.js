import { chatbox, p1, p2Chatbox } from '../../front-end.js';

export const appendMessage = (user, message, type) => {
    const p = document.createElement('p');
    p.className = type;
    p.textContent = message;
    const chat = p1[0] ? chatbox : p2Chatbox;
    chat.appendChild(p);
    chat.scrollTop = chat.scrollHeight;
}