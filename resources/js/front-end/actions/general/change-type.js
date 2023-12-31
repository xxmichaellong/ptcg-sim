import { p1, roomId, socket } from "../../front-end.js";
import { stringToVariable } from "../../setup/containers/string-to-variable.js";

export const changeType = (user, location, index, type, received = false) => {
    const _location = location;
    location = stringToVariable(user, location);
    const card = location.cards[index];

    if (!card.type2){
        card.type2 = card.type;
    };
    card.type = type;
    
    if (!p1[0] && !received){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: roomId,
            user: oUser,
            location: _location,
            index: index,
            type: type,
            received: true
        };
        socket.emit('changeType', data);
    };
}