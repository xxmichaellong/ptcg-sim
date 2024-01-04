import { deckArray, oppDeckArray, systemState, socket } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { zoneElementToArray } from '../../setup/zones/zone-element-to-array.js';
import { stringToVariable, variableToString } from '../../setup/zones/zone-string-to-variable.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { resetCounters } from '../counters/reset-ability-counters.js';
import { discardBoard } from './board-actions.js';
import { moveCard } from '../move-card-logic/move-card.js';
import { getZoneCount } from './count.js';
import { convertZoneName } from '../../setup/chatbox/move-card-message.js';

export const takeTurn = (user, emit = true) => {
    const oUser = user === 'self' ? 'opp' : 'self';
    discardBoard(user, false);
    discardBoard(oUser, false);
    resetCounters(false);

    const selectedDeckCount = user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
    if (selectedDeckCount > 0){
        systemState.turn ++;
        moveCard(user, 'deckArray', 'deckElement', 'handArray', 'handElement', 0, false, false);
        appendMessage(user, 'Turn ' + systemState.turn, 'announcement', false);

        ['benchElement', 'activeElement'].forEach(zoneElementString => {
            ['self', 'opp'].forEach(user => {
                const zoneArray = zoneElementToArray(user, zoneElementString);
                const zoneArrayString = variableToString(user, zoneArray);
                const zoneElement = stringToVariable(user, zoneElementString);
                Array.from(zoneElement.querySelectorAll('img')).forEach(image => {
                    if (image.faceDown){
                        image.src = image.src2;
                        image.faceDown = false;
                        const card = zoneArray.find(card => card.image === image);
                        appendMessage(user, determineUsername(user) + ' revealed ' + card.name + ' in ' + determineUsername(user) + "'s " + convertZoneName(zoneArrayString), 'player', false);
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