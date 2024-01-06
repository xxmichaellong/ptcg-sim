import { socket, systemState } from "../../front-end.js";
import { getZone } from "../../setup/zones/get-zone.js";

export const changeType = (user, zoneId, index, type, emit = true) => {
    const zone = getZone(user, zoneId);
    const card = zone.array[index];

    if (!card.type2){
        card.type2 = card.type;
    };
    card.type = type;
    
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: oUser,
            zoneId: zoneId,
            index: index,
            type: type,
            emit: false
        };
        socket.emit('changeType', data);
    };
}