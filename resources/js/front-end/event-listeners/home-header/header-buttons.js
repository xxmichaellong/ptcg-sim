import { reset } from '../../actions/general/reset.js';
import { connectedRoom, deckImportButton, lobby, p1, p1Button, p2Button, p2Chatbox, settingsButton, socket } from '../../front-end.js';
import { show } from '../../setup/home-header/header-toggle.js';

p1Button.addEventListener('click', () => {
    if (p1[0]) {
        show('p1Box', p1Button);
    } else if (window.confirm('Are you sure you want to leave the room?')) {
        socket.disconnect();
        lobby.style.display = 'block';
        connectedRoom.style.display = 'none';
        reset('self', true);
        reset('opp', true);
        socket.connect();
        p1[0] = true;
        p2Chatbox.innerHTML = '';
        show('p1Box', p1Button);
    };
});
p2Button.addEventListener('click', () => {show('p2Box', p2Button)});
deckImportButton.addEventListener('click', () => {show('deckImport', deckImportButton)});
settingsButton.addEventListener('click', () => {show('settings', settingsButton)});