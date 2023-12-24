import { reset } from '../../../actions/general/reset.js';
import { connectedRoom, copyButton, generateIdButton, joinRoomButton, leaveRoomButton, lobby, nameInput, p1, p2Chatbox, p2ExplanationBox, p2SelfUsername, roomHeaderCopyButton, roomHeaderText, roomId, roomIdInput, socket } from '../../../front-end.js';
import { p2DeckData } from '../../../socket/fetch-opp-data.js';

copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(roomIdInput.value);

    copyButton.classList.add('copied');
    setTimeout(() => {
        copyButton.classList.remove('copied');
    }, 1000);
});

roomHeaderCopyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(roomIdInput.value).then(() => {
        roomHeaderCopyButton.classList.add('copied');
        setTimeout(() => {
            roomHeaderCopyButton.classList.remove('copied');
        }, 1000);
    });
});

generateIdButton.addEventListener('click', () => {
    socket.emit('generateId');
});

joinRoomButton.addEventListener('click', () => {
    const names = ['Froakie', 'Shauna', 'Avery', 'Peonia', 'Korrina', 'Guzma', 'Bridgette', 'AZ', 'Xerosic', 'Colress', 'Melony', 'Serena', 'Thorton', 'Cyllene', 'Acerola', 'Marnie', 'Arven', 'Giovanni', 'Judge', 'Boss', 'Penny', 'Leon', 'Cheren', 'Elesa', 'Volo', 'Raihan', 'Ash', 'Brock', 'Misty', 'Cynthia', 'Oak', 'N', 'Roxanne', 'Iono', 'Irida', 'Lysandre', 'Cyrus', 'Hex', 'Skyla', 'Juniper', 'Sycamore'];
    const randomIndex = Math.floor(Math.random() * names.length);
    p2SelfUsername[0] = nameInput.value.trim() !== '' ? nameInput.value : names[randomIndex];
    roomId[0] = roomIdInput.value;
    socket.emit('joinGame', roomId[0], p2SelfUsername[0]);
});

leaveRoomButton.addEventListener('click', () => {
    if (window.confirm('Are you sure you want to leave the room?')) {
        socket.disconnect();
        lobby.style.display = 'block';
        p2ExplanationBox.style.display = 'block';
        connectedRoom.style.display = 'none';
        p1[0] = true;
        roomId[0] = '';
        socket.connect();
        reset('opp', true, true, true, false);
        reset('self', true, true, true, false);
        p2Chatbox.innerHTML = '';
        p2DeckData[0] = '';
    };
});