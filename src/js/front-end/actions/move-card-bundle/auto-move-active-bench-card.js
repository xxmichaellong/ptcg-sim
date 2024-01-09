import { moveCardBundle } from "./move-card-bundle.js";

export const autoMoveActiveBenchCard = (initiator, user, movingCard, targetCard, oZoneId, oZone, dZoneId, dZone, targetIndex) => {
    //case 1: no target, moving bench card to active
    if (['active'].includes(dZoneId)
    && dZone.array[1] //there is a card in active
    && !movingCard.image.attached //we are not attaching a card
    && !dZone.array[0].image.attached){
        moveCardBundle(initiator, user, 'active', 'bench', 0, false, 'move', false);
    } 
    // case 2: no target, only one Pokémon on bench
    else if (['bench'].includes(dZoneId) 
    && ['active'].includes(oZoneId)
    && dZone.array.filter(card => !card.image.attached).length === 2
    && oZone.array.filter(card => !card.image.attached).length === 0
    && !dZone.array[0].image.attached){
        moveCardBundle(initiator, user, 'bench', 'active', 0, false, 'move', false);

    //case 3: yes target, switch spots
    } else if (['active', 'bench'].includes(dZoneId) 
    && targetCard
    && !movingCard.image.attached //we are not attaching a card
    && !dZone.array[targetIndex].image.attached){
        moveCardBundle(initiator, user, dZoneId, oZoneId, targetIndex, false, 'move', false);
    };
}