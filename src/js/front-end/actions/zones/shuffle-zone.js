import { rearrangeArray, shuffleIndices } from '../../setup/general/shuffle.js'
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { systemState, socket } from '../../front-end.js';
import { sort } from "./general.js";
import { getZone } from '../../setup/zones/get-zone.js';

export const shuffleZone = (user, zoneId, indices, emit = true) => {
    const zone = getZone(user, zoneId);
    const shuffledIndices = indices ? indices : shuffleIndices(zone.getCount());
    removeImages(zone.element);
    rearrangeArray(zone.array, shuffledIndices);
    for (let i = 0; i < zone.getCount(); i++){
        zone.element.appendChild(zone.array[i].image);
    };
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : systemState.roomId,
            user: oUser,
            zoneId: zoneId,
            indices: shuffledIndices,
            emit: false
        };
        socket.emit('shuffleZone', data);
    };
    if (zoneId === 'deck'){
        sort(user, zoneId);
    };
}