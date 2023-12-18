import { reset } from '../../actions/general/reset.js';
import { chatbox, connectedRoom, copyButton, generateIdButton, joinRoomButton, leaveRoomButton, lobby, nameInput, p1, p2Chatbox, p2SelfUsername, roomHeaderCopyButton, roomHeaderText, roomId, roomIdInput, socket } from '../../front-end.js';

copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(roomIdInput.value)
});

roomHeaderCopyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(roomIdInput.value)
});

generateIdButton.addEventListener('click', () => {
    socket.emit('generateId');
});

joinRoomButton.addEventListener('click', () => {
    p2SelfUsername[0] = nameInput.value.trim() !== '' ? nameInput.value : 'Anonymous';
    roomId[0] = roomIdInput.value;
    roomHeaderText.textContent = 'id: ' + roomId;
    chatbox.innerHTML = '';
    socket.emit('joinGame', roomId[0], p2SelfUsername[0]);
});

leaveRoomButton.addEventListener('click', () => {
    if (window.confirm('Are you sure you want to leave the room?')) {
        socket.disconnect();
        lobby.style.display = 'block';
        connectedRoom.style.display = 'none';
        reset('self', true);
        reset('opp', true);
        socket.connect();
        p1[0] = true;
        p2Chatbox.innerHTML = '';
    };
});