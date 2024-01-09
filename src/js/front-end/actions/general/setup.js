import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { drawHand } from '../zones/hand-actions.js';
import { shuffleZone } from '../zones/shuffle-zone.js';
import { reset } from './reset.js';

export const setup = (user, indices, emit = true) => {
    reset(user, true, false);
    const deck = getZone(user, 'deck');
    indices = indices ? indices : shuffleIndices(deck.getCount());
    if (determineDeckData(user)){
        shuffleZone(user, user, 'deck', indices, false, false);
        drawHand(user, user);
        appendMessage(user, determineUsername(user) + ' drew starting hand and set prizes', 'player', false);
    };

    if (systemState.isTwoPlayer && emit){
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: user,
            indices: indices,
            emit: false
        };
        socket.emit('setup', data);
    };
};