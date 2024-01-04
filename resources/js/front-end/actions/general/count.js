import { selfContainersDocument, oppContainersDocument } from '../../front-end.js'
import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';

export const getZoneCount = (zoneArray) => zoneArray.length;

export const updateCount = () => {
    const zoneArrayString = ['deckArray', 'discardArray', 'lostZoneArray', 'handArray'];
  
    zoneArrayString.forEach((zoneArrayString) => {
        const selfElement = selfContainersDocument.getElementById(`${zoneArrayString}Count`);
        const oppElement = oppContainersDocument.getElementById(`${zoneArrayString}Count`);
    
        const selfZoneArray = stringToVariable('self', zoneArrayString);
        const oppZoneArray = stringToVariable('opp', zoneArrayString);

        selfElement.textContent = getZoneCount(selfZoneArray);
        oppElement.textContent = getZoneCount(oppZoneArray);
    });
};
  