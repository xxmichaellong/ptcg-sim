import { deck, oppDeck, p1, roomId, socket, turn } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { resetCounters } from '../counters/reset-ability-counters.js';
import { clearBoard } from './clear-board.js';
import { moveCard } from './move-card.js';

export const takeTurn = (user, received = false) => {
    const oUser = user === 'self' ? 'opp' : 'self';
    clearBoard(user, false);
    clearBoard(oUser, false);

    resetCounters(true);
    const deckCount = user === 'self' ? deck.count : oppDeck.count;
    if (deckCount > 0){
        turn[0] ++;
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0, false, true);
        appendMessage(user, 'Turn ' + turn, 'announcement', true);
        appendMessage(user, determineUsername(user) + ' drew for turn', 'player', true);
    } else {
        appendMessage(user, determineUsername(user) + ' has no more cards in deck!', 'announcement', true);
    };
    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            user : oUser,
            received: true
        };
        socket.emit('takeTurn', data);
    };
}