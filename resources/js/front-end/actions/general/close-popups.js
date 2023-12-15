import { lostzone_html, deck_html, discard_html, sCard, selfContainersDocument, active, bench, stadium_html, oppActive, oppBench, oppContainersDocument, oppDeck_html, oppDiscard_html, oppLostzone_html, cardContextMenu} from '../../front-end.js';
import { containerIdToLocation } from '../../setup/containers/container-reference.js';
import { stringToVariable, variableToString } from '../../setup/containers/string-to-variable.js';
import { addDamageCounter } from '../counters/damage-counter.js';
import { addSpecialCondition } from '../counters/special-condition.js';

export const closeContainerPopups = () => {
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
export const deselectCard = () => {
    if (sCard.card){
        sCard.card.image.classList.remove('highlight');
        sCard.selecting = false;

        const removeHighlightFromCards = (cards) => {
            cards.forEach(card => {
                card.image.classList.remove('selectHighlight');
            });
        };
        removeHighlightFromCards(active.cards);
        removeHighlightFromCards(bench.cards);
        removeHighlightFromCards(oppActive.cards);
        removeHighlightFromCards(oppBench.cards);
    };
}

export const closePopups = (event) => {
    deselectCard();
    closeFullView(event);
    cardContextMenu.style.display = 'none';
}

export const closeFullView = (event) => {
    const fullViewElement = selfContainersDocument.querySelector('.fullView') || oppContainersDocument.querySelector('.fullView');
    const user = selfContainersDocument.querySelector('.fullView') ? 'self' : 'opp';
    
    if (fullViewElement && !fullViewElement.contains(event.target)){
        // Revert the styles
        fullViewElement.className = 'playContainer'; // Remove the 'fullView' class
        fullViewElement.style.zIndex = ''; // Revert the z-index
        fullViewElement.style.height = ''; // Revert the height
            
        const allElements = fullViewElement.querySelectorAll('*');
        const targetImage = Array.from(allElements).filter((element) => {
            return !element.attached;
        });
    
        // Revert the position of the images
        const images = fullViewElement.querySelectorAll('img');
        images.forEach((img) => {
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
        stadium_html.style.zIndex = '0';
    };
}