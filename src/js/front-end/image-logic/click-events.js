import { cardContextMenu, oppContainer, oppDeckElement, oppDiscardElement, deckElement, lostZoneElement, discardElement, deckCoverElement, oppDeckCoverElement, oppLostZoneElement, discardCoverElement, oppDiscardCoverElement, lostZoneCoverElement, oppLostZoneCoverElement, sCard, selfContainer, selfContainerDocument, stadiumElement, systemState, target, } from '../front-end.js'
import { zoneElementToArray } from '../setup/zones/zone-element-to-array.js';
import { stringToVariable, variableToString } from '../setup/zones/zone-string-to-variable.js';
import { closeFullView, closePopups, deselectCard } from '../actions/general/close-popups.js';
import { moveCard } from '../actions/move-card-logic/move-card.js';
import { moveCardMessage } from '../setup/chatbox/move-card-message.js';
import { getZoneCount } from '../actions/general/count.js';

export const identifyCard = (event) => {
    if (event.target.user === 'self'){
        sCard.oUser = 'opp';
        sCard.user = 'self';
    } else {
        sCard.oUser = 'self';
        sCard.user = 'opp';
    };

    sCard.zoneElementString = event.target.parentElement.id;
    if (!sCard.zoneElementString){
        sCard.zoneElementString = event.target.parentElement.parentElement.id;
    };
    sCard.zoneElement = stringToVariable(sCard.user, sCard.zoneElementString);
    sCard.zoneArray = zoneElementToArray(sCard.user, sCard.zoneElementString);
    sCard.zoneArrayString = variableToString(sCard.user, sCard.zoneArray);
  
    if (sCard.zoneElementString === 'deckCoverElement'){
        sCard.index = 0;
    } else if (['lostZoneCoverElement', 'discardCoverElement'].includes(sCard.zoneElementString)){
        sCard.index = getZoneCount(sCard.zoneArray) - 1;
    } else {
        sCard.index = sCard.zoneArray.findIndex(card => card.image === event.target);
    };
}

export const coverClick = (event) => {
    let selectedElement;

    if (event.target.parentElement === deckCoverElement) {
        selectedElement = deckElement;
    } else if (event.target.parentElement === oppDeckCoverElement) {
        selectedElement = oppDeckElement;
    };
    if (event.target.parentElement === discardCoverElement) {
        selectedElement = discardElement;
    } else if (event.target.parentElement === oppDiscardCoverElement) {
        selectedElement = oppDiscardElement;
    };
    if (event.target.parentElement === lostZoneCoverElement) {
        selectedElement = lostZoneElement;
    } else if (event.target.parentElement === oppLostZoneCoverElement) {
        selectedElement = oppLostZoneElement;
    };
    if (selectedElement) {
        selectedElement.style.display = 'block';
    };
}

export const openCardContextMenu = (event) => {
    closeFullView(event);
    deselectCard();
    cardContextMenu.style.cssText = '';

    event.preventDefault();
    event.stopPropagation();

    identifyCard(event);

    const selfView = (selfContainerDocument.body.contains(event.target) && selfContainer.classList.contains('self')) || (!selfContainerDocument.body.contains(event.target) && !selfContainer.classList.contains('self'));
    const oppView = (!selfContainerDocument.body.contains(event.target) && selfContainer.classList.contains('self')) || (selfContainerDocument.body.contains(event.target) && !selfContainer.classList.contains('self'));
    
    const buttonConditions = {
        'abilityCounterButton': [[selfView, 'activeElement'], [oppView, 'activeElement'], [selfView, 'benchElement'], [oppView, 'benchElement']],
        'damageCounterButton': [[selfView, 'activeElement'], [oppView, 'activeElement'], [selfView, 'benchElement'], [oppView, 'benchElement']],
        'specialConditionButton': [[selfView, 'activeElement'], [oppView, 'activeElement']],
        'shufflePrizesButton': [[selfView, 'prizesElement']],
        'lookPrizesButton': [[selfView, 'prizesElement'], [oppView, 'prizesElement']],
        'revealHidePrizesButton': [[selfView, 'prizesElement'], [oppView, 'prizesElement']],
        'revealHideHandButton': [[oppView, 'handElement']],
        'revealRandomHandButton': [[oppView, 'handElement']],
        'shuffleDeckButton': [[selfView, 'deckCoverElement'], [oppView, 'deckCoverElement']],
        'drawButton': [[selfView, 'deckCoverElement']],
        'viewTopButton': [[selfView, 'deckCoverElement'], [oppView, 'deckCoverElement']],
        'viewBottomButton': [[selfView, 'deckCoverElement'], [oppView, 'deckCoverElement']],
        'discardHandButton': [[selfView, 'handElement']],
        'shuffleHandButton': [[selfView, 'handElement']],
        'shuffleHandBottomButton': [[selfView, 'handElement']],
        'prizesHeader': [[selfView, 'prizesElement'], [oppView, 'prizesElement']],
        'handHeader': [[selfView, 'handElement'], [oppView, 'handElement']],
        'deckHeader': [[selfView, 'deckCoverElement'], [oppView, 'deckCoverElement']],
        'boardHeader': [[selfView, 'boardElement'], [oppView, 'boardElement']],
        'discardBoardButton': [[selfView, 'boardElement'], [oppView, 'boardElement']],
        'handBoardButton': [[selfView, 'boardElement'], [oppView, 'boardElement']],
        'shuffleBoardButton': [[selfView, 'boardElement'], [oppView, 'boardElement']],
        'lostZoneBoardButton': [[selfView, 'boardElement'], [oppView, 'boardElement']],
        'changeButton': [[selfView, 'activeElement'], [oppView, 'activeElement'], [selfView, 'benchElement'], [oppView, 'benchElement']]

    };
    
    for (const [buttonId, conditionsArray] of Object.entries(buttonConditions)){
        const button = document.getElementById(buttonId);
      
        // Check each condition array
        const shouldDisplay = conditionsArray.some(conditions => {
            const [userCondition, containerCondition] = conditions;
            return userCondition && containerCondition === sCard.zoneElementString;
        });
      
        // Set display property based on conditions
        button.style.display = shouldDisplay ? 'block' : 'none';
    };

    const atLeastOneButtonVisible = Array.from(cardContextMenu.children)
    .some(button => button.style.display !== 'none');
    
    // Set the display property based on the visibility of buttons
    cardContextMenu.style.display = atLeastOneButtonVisible ? 'block' : 'none';

    // get the fucking position of this mf
    const targetRect = event.target.getBoundingClientRect();
    const offsetHeight = window.innerHeight - ((event.target.user === 'self') ? selfContainer.offsetHeight : oppContainer.offsetHeight);
    if (document.body.contains(event.target)){
        cardContextMenu.style.left = `${targetRect.left + event.target.clientWidth}px`;
        cardContextMenu.style.top = `${targetRect.top}px`;
    } else if (selfView){
        if (event.target.parentElement.id === 'deckCoverElement'){
            cardContextMenu.style.left = `${targetRect.left - cardContextMenu.clientWidth}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight}px`; 
        } else if (event.target.parentElement.id === 'handElement'){
            cardContextMenu.style.left = `${targetRect.left}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight}px`; 
        } else {
            cardContextMenu.style.left = `${targetRect.left + event.target.clientWidth}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight}px`; 
        };
    } else if (oppView){
        const adjustment = (document.body.offsetWidth - oppContainer.offsetWidth);
        if (event.target.parentElement.id === 'deckCoverElement'){
            cardContextMenu.style.right = `${targetRect.left + adjustment - cardContextMenu.clientWidth}px`;
            cardContextMenu.style.bottom = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight + event.target.offsetHeight}px`;
        } else if (event.target.parentElement.id === 'prizesElement'){
            cardContextMenu.style.right = `${targetRect.left + adjustment + event.target.clientWidth}px`;
            cardContextMenu.style.bottom = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight + event.target.offsetHeight}px`;
        } else {
            cardContextMenu.style.right = `${targetRect.left + adjustment - cardContextMenu.clientWidth + event.target.clientWidth}px`;
            cardContextMenu.style.bottom = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight}px`;
        };
    };
}

export const imageClick = (event) => {
    event.stopPropagation();

    if (event.target.classList.contains('selectHighlight')){
        closePopups(event);
        target.zoneElementString = event.target.parentElement.parentElement.id;
        target.zoneArray = zoneElementToArray(sCard.user, target.zoneElementString);
        target.index = target.zoneArray.findIndex(card => card.image === event.target);
        target.zoneArrayString = variableToString(sCard.user, target.zoneArray);
        moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, target.zoneArrayString, 'move', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
        moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, target.zoneArrayString, target.zoneElementString, sCard.index, target.index);
    } else {
        closePopups(event); //need both because of highlights
        identifyCard(event);
        sCard.card.image.classList.add('highlight');
        sCard.keybinds = true;
    };
}

export const doubleClick = (event) => {
    if (event){
        identifyCard(event);
    };
    const targetImage = sCard.card.image;
    targetImage.classList.remove('highlight');
    if (['benchElement', 'activeElement'].includes(sCard.zoneElementString) && !targetImage.parentElement.classList.contains('full-view')){
        const images = targetImage.parentElement.querySelectorAll('img');
        images.forEach((image) => {
            if (image.damageCounter){
                image.damageCounter.style.display = 'none';
            };
            if (image.specialCondition){
                image.specialCondition.style.display = 'none';
            };
            if (image.abilityCounter){
                image.abilityCounter.style.display = 'none';
            };
            if (image.attached){
                image.style.position = 'static';
            };
            image.classList.add('default-rotation');
        });
        targetImage.parentElement.className = 'full-view';
        if (document.querySelector('.dark-mode-1')){
            targetImage.parentElement.classList.add('dark-mode-5');
        };
        targetImage.parentElement.style.zIndex = '2';
        targetImage.parentElement.style.height = '70%';
        targetImage.parentElement.style.width = '69%';

        sCard.zoneElement.style.zIndex = '2';
        stadiumElement.style.zIndex = '-1';
    } else {
        let overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'; // Semi-transparent

        // Create a new image element
        let display = document.createElement('img');
        display.src = targetImage.src;
        display.alt = targetImage.alt;
        display.style.position = 'absolute';
        display.style.top = '50%';
        display.style.left = '50%';
        display.style.transform = 'translate(-50%, -50%)'; // Center the image
        display.style.maxWidth = '90%'; // Keep the image within the viewport
        display.style.maxHeight = '90%';
        display.style.borderRadius = '1rem';

        // Append the image to the overlay
        overlay.appendChild(display);

        // Append the overlay to the body
        document.body.appendChild(overlay);
    
        const removeOverlay = () => {
            if (overlay) {
                document.body.removeChild(overlay);
                overlay = null; // Set overlay to null to indicate it's no longer present
            };
        }

        overlay.addEventListener('click', () => removeOverlay());

        // Listen for the escape key press
        const documentArray = [selfContainerDocument, oppContainer, document];
        documentArray.forEach(document => document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' || event.key === 'v') {
                removeOverlay();
            };
        }));
    }
}