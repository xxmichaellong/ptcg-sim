import { systemState } from "../../front-end.js";
import { moveCard } from "./move-card.js";

export const updateStadiumCard = (user, dZoneId, dZone) => {
    if (['stadium'].includes(dZoneId) && dZone.array[1]) {
        if (dZone.array[0].image.user === 'self') {
            moveCard('self', 'stadium', 'discard', 0, false, false);
        } else {
            moveCard('opp', 'stadium', 'discard', 0, false, false);
        };
    };
    if ('stadium' === dZoneId){
        const stadiumElement = document.getElementById('stadium');
        stadiumElement.style.transform = user === systemState.pov.user ? 'scaleX(1) scaleY(1)' : 'scaleX(-1) scaleY(-1)';
    };
}