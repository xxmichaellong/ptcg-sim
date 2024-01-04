import { rearrangeArray, shuffleIndices } from '../../setup/general/shuffle.js'
import { removeImages } from '../../image-logic/remove-images.js';
import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';
import { systemState, socket } from '../../front-end.js';
import { sort } from '../general/sort.js';
import { getZoneCount } from '../general/count.js';

export const shuffleZone = (user, zoneArrayString, zoneElementString, indices, emit = true) => {
    const zoneArray = stringToVariable(user, zoneArrayString);
    const zoneElement = stringToVariable(user, zoneElementString);
    const shuffledIndices = indices ? indices : shuffleIndices(getZoneCount(zoneArray));
    removeImages(zoneElement);
    rearrangeArray(zoneArray, shuffledIndices);
    for (let i = 0; i < getZoneCount(zoneArray); i++){
        zoneElement.appendChild(zoneArray[i].image);
    };
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : systemState.roomId,
            user: oUser,
            zoneArrayString : zoneArrayString,
            zoneElementString: zoneElementString,
            indices: shuffledIndices,
            emit: false
        };
        socket.emit('shuffleZone', data);
    };
    if (zoneArrayString === 'deckArray'){
        sort(user, zoneArrayString, zoneElementString);
    };
}