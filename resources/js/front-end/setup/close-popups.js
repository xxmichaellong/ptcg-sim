import { lostzone_html, deck_html, discard_html, attachedCardPopup, attachedCardPopup_html } from "./initialization.js";
import { oppAttachedCardPopup, oppAttachedCardPopup_html } from "./opp-initialization.js";

export function closePopups(){
    cardPopup.style.display = "none";
    pokestopPopup.style.display = "none";
    flowerSelectingPopup.style.display = "none";
    colresssExperimentPopup.style.display = "none";
    lostzone_html.style.display = "none";
    deck_html.style.display = "none";
    discard_html.style.display = "none";

    if (attachedCardPopup.count === 0){
        attachedCardPopup_html.style.display = 'none';
    };
    if (oppAttachedCardPopup.count === 0){
        oppAttachedCardPopup_html.style.display = 'none';
    };
}