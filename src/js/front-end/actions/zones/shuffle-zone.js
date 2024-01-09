import { socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { rearrangeArray, shuffleIndices } from '../../setup/general/shuffle.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { sort } from "./general.js";

export const shuffleZone = (initiator, user, zoneId, indices, message = true, emit = true) => {
    const zone = getZone(user, zoneId);
    removeImages(zone.element);
    indices = indices ? indices : shuffleIndices(zone.getCount());
    rearrangeArray(zone.array, indices);
    for (let i = 0; i < zone.getCount(); i++){
        zone.element.appendChild(zone.array[i].image);
    };
    if (zoneId === 'deck'){
        sort(user, zoneId);
    };
    if (message){
        appendMessage(initiator, determineUsername(user) + ' shuffled ' + zoneId, 'player', false);
    };

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            zoneId: zoneId,
            indices: indices,
            emit: false
        };
        socket.emit('shuffleZone', data);
    };
}