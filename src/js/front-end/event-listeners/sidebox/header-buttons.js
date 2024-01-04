import { reset } from '../../actions/general/reset.js';
import { connectedRoom, deckImportButton, lobby, systemState, p1Button, p2Button, p2Chatbox, p2ExplanationBox, settingsButton, socket } from '../../front-end.js';
import { show } from '../../setup/home-header/header-toggle.js';

p1Button.addEventListener('click', () => {
    if (!systemState.isTwoPlayer) {
        show('p1Box', p1Button);
    } else if (window.confirm('Are you sure you want to leave the room? Battle log will be erased.')) {
        socket.disconnect();
        p2ExplanationBox.style.display = 'block';
        lobby.style.display = 'block';
        connectedRoom.style.display = 'none';
        systemState.isTwoPlayer = false;
        systemState.roomId = '';
        socket.connect();
        reset('opp', true, false, true, false);
        reset('self', true, false, true, false);
        p2Chatbox.innerHTML = '';
        systemState.p2OppDeckData = '';
        show('p1Box', p1Button);
    };
});
p2Button.addEventListener('click', () => {show('p2Box', p2Button)});
deckImportButton.addEventListener('click', () => {show('deckImport', deckImportButton)});
settingsButton.addEventListener('click', () => {show('settings', settingsButton)});