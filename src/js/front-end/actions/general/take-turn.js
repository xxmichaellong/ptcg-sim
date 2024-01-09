import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { resetAbilityCounters } from '../counters/reset-counters.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { discardBoard } from './board-actions.js';

export const takeTurn = (initiator, user, emit = true) => {
    const deck = getZone(user, 'deck');
    discardBoard(initiator, 'self', false, false);
    discardBoard(initiator, 'opp', false, false);
    resetAbilityCounters();

    if (deck.getCount() > 0){
        systemState.turn ++;
        moveCard(initiator, user, 'deck', 'hand', 0);
        appendMessage('', 'Turn ' + systemState.turn, 'announcement', false);

        ['active', 'bench'].forEach(zoneId => {
            ['self', 'opp'].forEach(user => {
                const zone = getZone(user, zoneId);
                Array.from(zone.element.querySelectorAll('img')).forEach(image => {
                    if (image.faceDown){
                        image.src = image.src2;
                        image.faceDown = false;
                        const card = zone.array.find(card => card.image === image);
                        appendMessage(user, determineUsername(user) + ' revealed ' + card.name + ' in ' + determineUsername(user) + "'s " + zoneId, 'player', false);
                    };
                });
            });
        });

        appendMessage(initiator, determineUsername(initiator) + ' drew for turn', 'player', false);
    } else {
        appendMessage('', determineUsername(initiator) + ' has no more cards in deck!', 'announcement', false);
    };
    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            emit: false
        };
        socket.emit('takeTurn', data);
    };
}