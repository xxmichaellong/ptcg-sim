import { cardContextMenu, cardPopup } from "../image-logic/click-events.js";
import { lostzone_html, deck_html, discard_html, attachedCardPopup, attachedCardPopup_html } from "./initialization.js";
import { oppAttachedCardPopup, oppAttachedCardPopup_html, oppDeck_html, oppDiscard_html, oppLostzone_html } from "./opp-initialization.js";

export function closeContainerPopups(){
    lostzone_html.style.display = 'none';
    deck_html.style.display = 'none';
    discard_html.style.display = 'none';
    oppLostzone_html.style.display = 'none';
    oppDeck_html.style.display = 'none';
    oppDiscard_html.style.display = 'none';

    if (attachedCardPopup.count === 0){
        attachedCardPopup_html.style.display = 'none';
    };
    if (oppAttachedCardPopup.count === 0){
        oppAttachedCardPopup_html.style.display = 'none';
    };
}

export function closePopups(){
    cardPopup.style.display = 'none';
    cardContextMenu.style.display = 'none';
}