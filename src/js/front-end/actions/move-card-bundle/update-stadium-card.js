import { systemState } from "../../front-end.js";
import { moveCard } from "./move-card.js";

export const updateStadiumCard = (initiator, user, dZoneId, dZone) => {
    if (['stadium'].includes(dZoneId) && dZone.array[1]) {
        if (dZone.array[0].image.user === 'self') {
            moveCard(initiator, 'self', 'stadium', 'discard', 0);
        } else {
            moveCard(initiator, 'opp', 'stadium', 'discard', 0);
        };
    };
    if ('stadium' === dZoneId){
        const stadiumElement = document.getElementById('stadium');
        stadiumElement.style.transform = user === systemState.initiator ? 'scaleX(1) scaleY(1)' : 'scaleX(-1) scaleY(-1)';
    };
}