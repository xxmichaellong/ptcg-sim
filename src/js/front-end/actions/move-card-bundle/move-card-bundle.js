import { socket, systemState } from "../../front-end.js";
import { moveCardMessage } from "./move-card-message.js";
import { moveCard } from "./move-card.js";

export const moveCardBundle = (initiator, user, oZoneId, dZoneId, index, targetIndex, action, emit = true) => {
    moveCardMessage(initiator, user, oZoneId, dZoneId, index, targetIndex, action);
    moveCard(initiator, user, oZoneId, dZoneId, index, targetIndex);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            oZoneId: oZoneId,
            dZoneId: dZoneId,
            index: index,
            targetIndex: targetIndex,
            action: action,
            emit: false
        };
        socket.emit('moveCardBundle', data);
    };
}