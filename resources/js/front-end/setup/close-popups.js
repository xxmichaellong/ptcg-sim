import { cardContextMenu, cardPopup } from "../image-logic/click-events.js";
import { lostzone_html, deck_html, discard_html, attachedCardPopup, attachedCardPopup_html, viewCards, viewCards_html, sCard } from "./self-initialization.js";
import { oppAttachedCardPopup, oppAttachedCardPopup_html, oppDeck_html, oppDiscard_html, oppLostzone_html, oppViewCards, oppViewCards_html } from "./opp-initialization.js";
import { containerIdToLocation } from "./container-reference.js";
import { stringToVariable } from "./string-to-variable.js";

export function closeContainerPopups(){
    const elementsToHide = [
        lostzone_html,
        deck_html,
        discard_html,
        oppLostzone_html,
        oppDeck_html,
        oppDiscard_html,
    ];
    
    elementsToHide.forEach(element => {
        element.style.display = 'none';
    });
}

export const hideIfEmpty = (user, containerId) => {
    if (['discard_html', 'lostzone_html', 'deck_html', 'attachedCardPopup_html', 'viewCards_html'].includes(containerId)){
        const location = containerIdToLocation(user, containerId);
        const location_html = stringToVariable(user, containerId);
        if (location.count === 0) {
            location_html.style.display = 'none';
        };
    };
}

export function closePopups(){
    cardPopup.style.display = 'none';
    cardContextMenu.style.display = 'none';
}