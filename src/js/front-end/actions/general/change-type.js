import { socket, systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { getZone } from "../../setup/zones/get-zone.js";
import { moveCard } from "../move-card-bundle/move-card.js";

export const changeType = (initiator, user, zoneId, index, type, emit = true) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];

    if (!card.type2){
        card.type2 = card.type;
    };
    card.type = type;

    const cardName = card.image.faceDown ? 'card' : card.name;
    const typeName = type === 'Energy' ? 'energy' : 'tool';
    appendMessage(initiator, determineUsername(initiator) + ' changed ' + cardName + ' into an ' + typeName, 'player', false);
    moveCard(initiator, user, zoneId, 'board', index);    
    
    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            index: index,
            type: type,
            emit: false
        };
        socket.emit('changeType', data);
    };
}