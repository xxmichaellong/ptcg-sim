import { POV, deck, oppDeck, p1, roomId, socket, turn } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { moveCard } from './move-card.js';

export const takeTurn = (user, received = false) => {
    const deckCount = user === 'self' ? deck.count : oppDeck.count;
    if (deckCount > 0){
        turn[0] ++;
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0, false, true);
        appendMessage(user, 'Turn ' + turn, 'announcement', true);
        appendMessage(user, determineUsername(user) + ' drew for turn', 'announcement', true);
    } else {
        appendMessage(user, determineUsername(user) + ' has no more cards in deck!', 'announcement', true);
    };
    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            user : POV.oUser,
            received: true
        };
        socket.emit('takeTurn', data);
    };
}