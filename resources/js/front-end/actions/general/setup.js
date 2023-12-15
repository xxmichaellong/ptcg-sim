import { POV, deck, oppDeck, p1, roomId, socket } from '../../front-end.js';
import { shuffleIndices } from '../../setup/general/shuffle.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { drawHand } from '../container/hand-actions.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { reset } from './reset.js';

export const setup = (user, indices, received = false) => {
    reset(user, true);
    const setupIndices = indices || (user === 'self' ? shuffleIndices(deck.cards.length) : shuffleIndices(oppDeck.cards.length));
    drawHand(user, setupIndices);

    appendMessage(user, determineUsername(user) + ' setup', 'announcement');
    if (!p1[0] && !received) {
        const data = {
            roomId: roomId,
            user: POV.oUser,
            indices: setupIndices,
            received: true
        };
        socket.emit('setup', data);
    };
};
