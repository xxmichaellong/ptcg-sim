import { deck, oppDeck, p1, roomId, socket, turn } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { containerIdToLocation } from '../../setup/containers/container-reference.js';
import { stringToVariable, variableToString } from '../../setup/containers/string-to-variable.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { resetCounters } from '../counters/reset-ability-counters.js';
import { discardBoard } from './clear-board.js';
import { moveCard } from './move-card.js';

export const takeTurn = (user, received = false) => {
    const oUser = user === 'self' ? 'opp' : 'self';
    discardBoard(user, false);
    discardBoard(oUser, false);
    resetCounters(true);

    const deckCount = user === 'self' ? deck.count : oppDeck.count;
    if (deckCount > 0){
        turn[0] ++;
        moveCard(user, 'deck', 'deck_html', 'hand', 'hand_html', 0, false, true);
        appendMessage(user, 'Turn ' + turn, 'announcement', true);

        ['bench_html', 'active_html'].forEach(containerId => {
            ['self', 'opp'].forEach(user => {
                const location = containerIdToLocation(user, containerId);
                const locationAsString = variableToString(user, location);
                const container = stringToVariable(user, containerId);
                Array.from(container.querySelectorAll('img')).forEach(image => {
                    if (image.faceDown){
                        image.src = image.src2;
                        image.faceDown = false;
                        const card = location.cards.find(card => card.image === image);
                        appendMessage(user, determineUsername(user) + ' revealed ' + card.name + ' in ' + determineUsername(user) + "'s " + locationAsString, 'player', true);
                    };
                });
            });
        });

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