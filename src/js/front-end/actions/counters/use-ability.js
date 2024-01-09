import { socket, systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { getZone } from "../../setup/zones/get-zone.js";
import { addAbilityCounter } from "./ability-counter.js";

export const useAbility = (initiator, user, zoneId, index, emit = true) => {
    const cardName = getZone(user, zoneId).array[index].name;
    addAbilityCounter(user, zoneId, index);
    if (zoneId !== 'stadium'){
        appendMessage(initiator, determineUsername(initiator) + ' used ' + cardName + "'s ability", 'player', false);
    } else {
        appendMessage(initiator, determineUsername(initiator) + ' used ' + cardName, 'player', false);
    };
    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId : zoneId,
            index: index,
            emit: false
        };
        socket.emit('useAbility', data);
    };
}