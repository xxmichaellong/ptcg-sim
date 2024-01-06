import { systemState } from "../../front-end.js";
import { moveCardMessage } from "../../setup/chatbox/move-card-message.js";
import { moveCard } from "./move-card.js";

export const autoMoveActiveBenchCard = (user, movingCard, targetCard, oZoneId, oZone, dZoneId, dZone, targetIndex, emit) => {
    //case 1: no target, moving bench card to active
    if (['active'].includes(dZoneId)
    && dZone.array[1] //there is a card in active
    && !movingCard.image.attached //we are not attaching a card
    && !dZone.array[0].image.attached){
        if (emit){
            moveCardMessage(systemState.pov.user, dZone.array[0].name, 'active', 'bench', 'move', false, dZone.array[0].image.faceDown);
        };
        moveCard(user, 'active', 'bench', 0, false, false);
    } 
    // case 2: no target, only one Pokémon on bench
    else if (['bench'].includes(dZoneId) 
    && ['active'].includes(oZoneId)
    && dZone.array.filter(card => !card.image.attached).length === 2
    && oZone.array.filter(card => !card.image.attached).length === 0
    && !dZone.array[0].image.attached){
        if (emit){
            moveCardMessage(systemState.pov.user, dZone.array[0].name, 'bench', 'active', 'move', false, dZone.array[0].image.faceDown);
        };
        moveCard(user, 'bench', 'active', 0, false, false);

    //case 3: yes target, switch spots
    } else if (['active', 'bench'].includes(dZoneId) 
    && targetCard
    && !movingCard.image.attached //we are not attaching a card
    && !dZone.array[targetIndex].image.attached){
        if (emit){
            moveCardMessage(systemState.pov.user, dZone.array[targetIndex].name, dZoneId, oZoneId, 'move', false, dZone.array[targetIndex].image.faceDown);
        };
        moveCard(user, dZoneId, oZoneId, targetIndex, false, false);
    };
}