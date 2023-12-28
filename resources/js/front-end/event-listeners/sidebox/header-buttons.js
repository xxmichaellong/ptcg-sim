import { reset } from '../../actions/general/reset.js';
import { connectedRoom, deckImportButton, lobby, p1, p1Button, p2Button, p2Chatbox, p2ExplanationBox, roomId, settingsButton, socket } from '../../front-end.js';
import { show } from '../../setup/home-header/header-toggle.js';
import { p2DeckData } from '../../socket/fetch-opp-data.js';

p1Button.addEventListener('click', () => {
    if (p1[0]) {
        show('p1Box', p1Button);
    } else if (window.confirm('Are you sure you want to leave the room? Battle log will be erased.')) {
        socket.disconnect();
        p2ExplanationBox.style.display = 'block';
        lobby.style.display = 'block';
        connectedRoom.style.display = 'none';
        p1[0] = true;
        roomId[0] = '';
        socket.connect();
        reset('opp', true, true, true, false);
        reset('self', true, true, true, false);
        p2Chatbox.innerHTML = '';
        p2DeckData[0] = '';
        show('p1Box', p1Button);
    };
});
p2Button.addEventListener('click', () => {show('p2Box', p2Button)});
deckImportButton.addEventListener('click', () => {show('deckImport', deckImportButton)});
settingsButton.addEventListener('click', () => {show('settings', settingsButton)});