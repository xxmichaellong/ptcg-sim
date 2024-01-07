import { reset } from '../../../actions/general/reset.js';
import { socket, systemState } from '../../../front-end.js';
import { show } from '../../../setup/home-header/header-toggle.js';

export const initializeHeaderButtons = () => {
    const connectedRoom = document.getElementById('connectedRoom');
    const lobby = document.getElementById('lobby');
    const p2Chatbox = document.getElementById('p2ExplanationBox');
    const p2ExplanationBox = document.getElementById('p2ExplanationBox');

    const p1Button = document.getElementById('p1Button');
    p1Button.addEventListener('click', () => {
        if (!systemState.isTwoPlayer) {
            show('p1Box', p1Button);
        } else if (window.confirm('Are you sure you want to leave the room? Battle log will be erased.')) {
            const data = {
                roomId: systemState.roomId,
                username: systemState.p2SelfUsername
            };
            socket.emit('leaveRoom', data);
            p2ExplanationBox.style.display = 'block';
            lobby.style.display = 'block';
            connectedRoom.style.display = 'none';
            systemState.isTwoPlayer = false;
            systemState.roomId = '';
            reset('opp', true, false, true, false);
            reset('self', true, false, true, false);
            p2Chatbox.innerHTML = '';
            systemState.p2OppDeckData = '';
            show('p1Box', p1Button);
        }
    });

    const p2Button = document.getElementById('p2Button');
    p2Button.addEventListener('click', () => { show('p2Box', p2Button) });

    const deckImportButton = document.getElementById('deckImportButton');
    deckImportButton.addEventListener('click', () => { show('deckImport', deckImportButton) });

    const settingsButton = document.getElementById('settingsButton');
    settingsButton.addEventListener('click', () => { show('settings', settingsButton) });
};