import { lostZoneElement, deckElement, discardElement, sCard, selfContainerDocument, activeArray, benchArray, stadiumElement, oppActiveArray, oppBenchArray, oppContainerDocument, oppDeckElement, oppDiscardElement, oppLostZoneElement, attachedCardsElement, viewCardsElement, oppAttachedCardsElement, oppViewCardsElement} from '../../front-end.js';
import { zoneElementToArray } from '../../setup/zones/zone-element-to-array.js';
import { stringToVariable } from '../../setup/zones/zone-string-to-variable.js';
import { reloadBoard } from '../../setup/sizing/reload-board.js';
import { cardContextMenu } from '../../initialization/html-elements/context-menu.js';
import { getZoneCount } from './count.js';

export const hideZoneElements = () => {
    const elementsToHide = [
        lostZoneElement,
        deckElement,
        discardElement,
        attachedCardsElement,
        viewCardsElement,
        oppLostZoneElement,
        oppDeckElement,
        oppDiscardElement,
        oppAttachedCardsElement,
        oppViewCardsElement
    ];
    
    elementsToHide.forEach(element => {
        element.style.display = 'none';
    });
}
export const hideElementsIfEmpty = () => {
    const elementStringArray = ['discardElement', 'lostZoneElement', 'deckElement', 'attachedCardsElement', 'viewCardsElement'];
    const userArray = ['self', 'opp'];

    userArray.forEach(user => {
        elementStringArray.forEach(elementString =>{
            const zoneArray = zoneElementToArray(user, elementString);
            const zoneElement = stringToVariable(user, elementString);
            if (getZoneCount(zoneArray) === 0){
                zoneElement.style.display = 'none';
            } else if (getZoneCount(zoneArray) !== 0 && ['attachedCardsElement', 'viewCardsElement'].includes(elementString)){
                zoneElement.style.display = 'block';
            };
        });
    });
}
        
const removeHighlightFromCards = (cards) => {
    cards.forEach(card => {
        card.image.classList.remove('selectHighlight');
    });
};

export const deselectCard = () => {
    if (sCard.card){
        sCard.card.image.classList.remove('highlight');
        sCard.keybinds = false;
        removeHighlightFromCards(activeArray);
        removeHighlightFromCards(benchArray);
        removeHighlightFromCards(oppActiveArray);
        removeHighlightFromCards(oppBenchArray);
    };
}

export const closeFullView = (event) => {
    const fullViewElement = selfContainerDocument.querySelector('.full-view') || oppContainerDocument.querySelector('.full-view');
    
    if (fullViewElement && (!event || !fullViewElement.contains(event.target))){
        // Revert the styles
        fullViewElement.className = 'play-container';
        fullViewElement.style.zIndex = ''; // Revert the z-index
        fullViewElement.style.height = ''; // Revert the height
            
        const allElements = fullViewElement.querySelectorAll('*');
        const targetImage = Array.from(allElements).filter((element) => {
            return !element.attached;
        });
    
        // Revert the position of the images
        const images = fullViewElement.querySelectorAll('img');
        images.forEach((image) => {
            image.classList.remove('default-rotation');
            if (image.attached){
                image.style.position = 'absolute';
            };
        });

        const currentWidth = parseFloat(targetImage[0].clientWidth);
        const newWidth = currentWidth + targetImage[0].clientWidth/6 * targetImage[0].energyLayer;
        fullViewElement.style.width = newWidth + 'px';
        fullViewElement.style.zIndex = '0';

        // Revert the z-indexes
        fullViewElement.parentElement.style.zIndex = '0';
        stadiumElement.style.zIndex = '0';
        reloadBoard();
    };
}

export const closePopups = (event) => {
    deselectCard();
    closeFullView(event);
    hideElementsIfEmpty();
    cardContextMenu.style.display = 'none';
}