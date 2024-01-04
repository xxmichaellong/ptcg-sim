import { reset } from '../../../actions/general/reset.js';
import { connectedRoom, copyButton, generateIdButton, joinRoomButton, leaveRoomButton, lobby, nameInput, systemState, p2Chatbox, p2ExplanationBox, roomHeaderCopyButton, roomIdInput, socket } from '../../../front-end.js';

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
    roomIdInput.value = socket.id.toString() + '0';
});

joinRoomButton.addEventListener('click', () => {
    const names = ['Froakie', 'Shauna', 'Avery', 'Peonia', 'Korrina', 'Guzma', 'Bridgette', 'AZ', 'Xerosic', 'Colress', 'Melony', 'Serena', 'Thorton', 'Cyllene', 'Acerola', 'Marnie', 'Arven', 'Giovanni', 'Judge', 'Boss', 'Penny', 'Leon', 'Cheren', 'Elesa', 'Volo', 'Raihan', 'Ash', 'Brock', 'Misty', 'Cynthia', 'Oak', 'N', 'Roxanne', 'Iono', 'Irida', 'Lysandre', 'Cyrus', 'Hex', 'Skyla', 'Juniper', 'Sycamore'];
    const randomIndex = Math.floor(Math.random() * names.length);
    systemState.p2SelfUsername = nameInput.value.trim() !== '' ? nameInput.value : names[randomIndex];
    systemState.roomId = roomIdInput.value;
    socket.emit('joinGame', systemState.roomId, systemState.p2SelfUsername);
});

leaveRoomButton.addEventListener('click', () => {
    if (window.confirm('Are you sure you want to leave the room? Battle log will be erased.')) {
        socket.disconnect();
        lobby.style.display = 'block';
        p2ExplanationBox.style.display = 'block';
        connectedRoom.style.display = 'none';
        systemState.isTwoPlayer = false;
        systemState.roomId = '';
        socket.connect();
        reset('opp', true, false, true, false);
        reset('self', true, false, true, false);
        p2Chatbox.innerHTML = '';
        systemState.p2OppDeckData = '';
    };
});