import { systemState, socket } from "../../front-end.js";
import { stringToVariable } from "../../setup/zones/zone-string-to-variable.js";

export const changeType = (user, zoneArrayString, index, type, emit = true) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const card = zoneArray[index];

    if (!card.type2){
        card.type2 = card.type;
    };
    card.type = type;
    
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: oUser,
            zoneArrayString: zoneArrayString,
            index: index,
            type: type,
            emit: false
        };
        socket.emit('changeType', data);
    };
}