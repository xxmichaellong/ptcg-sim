import { socket, systemState } from '../../front-end.js';

export const appendMessage = (user, message, type, emit = true) => {
  if (!systemState.isUndoInProgress) {
    const chatbox = document.getElementById('chatbox');
    const p2Chatbox = document.getElementById('p2Chatbox');

    const p = document.createElement('p');
    if (type === 'player') {
      p.className = user === 'self' ? 'self-text' : 'opp-text';
    } else if (type === 'message') {
      p.className = user === 'self' ? 'self-message' : 'opp-message';
    } else {
      p.className = type;
    }
    p.textContent = message;
    const chat = !systemState.isTwoPlayer ? chatbox : p2Chatbox;
    chat.appendChild(p);
    chat.scrollTop = chat.scrollHeight;
    if (systemState.isTwoPlayer && emit) {
      user = user === 'self' ? 'opp' : 'self';
      const data = {
        roomId: systemState.roomId,
        user: user,
        message: message,
        type: type,
        emit: false,
        socketId: socket.id,
      };
      socket.emit('appendMessage', data);
    }
  }
};
