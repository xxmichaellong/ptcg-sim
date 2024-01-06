import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { resetCounters } from '../counters/reset-ability-counters.js';
import { moveCard } from '../move-card-logic/move-card.js';
import { discardBoard } from './board-actions.js';

export const takeTurn = (user, emit = true) => {
    const deck = getZone(user, 'deck');

    const oUser = user === 'self' ? 'opp' : 'self';
    discardBoard(user, false);
    discardBoard(oUser, false);
    resetCounters(false);

    if (deck.getCount() > 0){
        systemState.turn ++;
        moveCard(user, 'deck', 'hand', 0, false, false);
        appendMessage(user, 'Turn ' + systemState.turn, 'announcement', false);

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

        appendMessage(user, determineUsername(user) + ' drew for turn', 'player', false);
    } else {
        appendMessage(user, determineUsername(user) + ' has no more cards in deck!', 'announcement', false);
    };
    if (systemState.isTwoPlayer && emit){
        const data = {
            roomId : systemState.roomId,
            user : oUser,
            emit: false
        };
        socket.emit('takeTurn', data);
    };
}