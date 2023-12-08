import { cardContextMenu, cardPopup } from "../image-logic/click-events.js";
import { lostzone_html, deck_html, discard_html, attachedCardPopup, attachedCardPopup_html, viewCards, viewCards_html, sCard, selfContainersDocument, active, bench } from "./self-initialization.js";
import { oppActive, oppAttachedCardPopup, oppAttachedCardPopup_html, oppBench, oppContainersDocument, oppDeck_html, oppDiscard_html, oppLostzone_html, oppViewCards, oppViewCards_html } from "./opp-initialization.js";
import { containerIdToLocation } from "./container-reference.js";
import { stringToVariable, variableToString } from "./string-to-variable.js";
import { addDamageCounter } from "../general-actions/damage-counter.js";
import { addSpecialCondition } from "../general-actions/special-condition.js";

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
        if (location.count === 0){
            location_html.style.display = 'none';
        };
    };
}
export function deselectCard(){
    if (sCard.card){
        sCard.card.image.classList.remove('highlight');
        sCard.selecting = false;

        function removeHighlightFromCards(cards) {
            cards.forEach(card => {
                card.image.classList.remove('selectHighlight');
            });
        }
        removeHighlightFromCards(active.cards);
        removeHighlightFromCards(bench.cards);
        removeHighlightFromCards(oppActive.cards);
        removeHighlightFromCards(oppBench.cards);
    };
}

export function closePopups(event){
    deselectCard();

    cardPopup.style.display = 'none';
    cardContextMenu.style.display = 'none';

    const fullViewElement = selfContainersDocument.querySelector('.fullView') || oppContainersDocument.querySelector('.fullView');
    const user = selfContainersDocument.querySelector('.fullView') ? 'self' : 'opp';

    if (fullViewElement && !fullViewElement.contains(event.target)){
        // Revert the styles
        fullViewElement.className = 'playContainer'; // Remove the 'fullView' class
        fullViewElement.style.zIndex = ''; // Revert the z-index
        fullViewElement.style.height = ''; // Revert the height
            
        const allElements = fullViewElement.querySelectorAll('*');
        const targetImage = Array.from(allElements).filter(function(element){
            return !element.attached;
        });
    
        // Revert the position of the images
        const images = fullViewElement.querySelectorAll('img');
        images.forEach(function(img){
            if (img.attached){
            img.style.position = 'absolute';
            }
        });

        const currentWidth = parseFloat(targetImage[0].clientWidth);
        const newWidth = currentWidth + targetImage[0].clientWidth/6 * targetImage[0].energyLayer;
        fullViewElement.style.width = newWidth + 'px';
        fullViewElement.style.zIndex = '0';

        const _location_html = fullViewElement.parentElement.id;
        const location = containerIdToLocation(user, _location_html);
        const _location = variableToString(user, location);

        for (let i = 0; i < location.cards.length; i++){
            const image = location.cards[i].image;
            if (image.damageCounter){
                addDamageCounter(user, _location, _location_html, i);
            };
            if (image.specialCondition){
                addSpecialCondition(user, _location, _location_html, i);
            };
        };

        // Revert the z-index of the sCard.container
        fullViewElement.parentElement.style.zIndex = '0';
    };
}