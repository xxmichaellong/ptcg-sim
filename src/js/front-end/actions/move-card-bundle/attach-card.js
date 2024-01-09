import { resetImage } from "../../setup/image-logic/reset-image.js";
import { matchRotation } from "../general/rotate-card.js";
import { moveCard } from "./move-card.js";

export const attachCard = (initiator, user, movingCard, targetCard, dZoneId, dZone) => {
    //figure out where card is coming from-same parent or different? being reattached or evolve?
    const nonEvolveAttachment = movingCard.image.target === 'on' || !movingCard.image.parentElement.classList.contains('play-container');
    // format the card so it's attached to targetImage
    resetImage(movingCard.image);

    movingCard.image.attached = true;
    movingCard.image.target = 'on';
    movingCard.image.relative = targetCard.image;
    movingCard.image.style.position = 'absolute';

    let layer;
    if (movingCard.type !== 'Pokémon'){
        const adjustment = targetCard.image.clientWidth/6;
        targetCard.image.energyLayer += 1;
        layer = targetCard.image.energyLayer;
        movingCard.image.style.left = `${layer * adjustment}px`;
        
        //adjust width of container
        const currentWidth = parseFloat(targetCard.image.parentElement.clientWidth);
        const newWidth = currentWidth + adjustment;
        targetCard.image.parentElement.style.width = newWidth + 'px';
    } else {
        const adjustment = targetCard.image.clientWidth/14;
        targetCard.image.layer += 1;
        layer = targetCard.image.layer;
        movingCard.image.style.bottom = `${layer * adjustment}px`;
    };
    movingCard.image.style.zIndex -= layer;

    //rotate tool/energy to the same orientation of card
    matchRotation(movingCard.image, targetCard.image);

    targetCard.image.after(movingCard.image);

    // move tools to the back of the image, index cannot be zero to prevent being called when evolving Pokémon
    if (movingCard.type === 'Energy' && nonEvolveAttachment){
        for (let i = 0; i < dZone.getCount() - 1; i++){
            if (dZone.array[i].image.relative === movingCard.image.relative && !['Pokémon', 'Energy'].includes(dZone.array[i].type)){
                const targetIndex = dZone.array.findIndex(card => card.image === movingCard.image.relative);
                moveCard(initiator, user, dZoneId, dZoneId, i, targetIndex);
                i--;
            };
            if (dZone.array[i] === movingCard){
                break;
            };
        };
    };
}