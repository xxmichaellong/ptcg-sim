import { closeFullView, closePopups, deselectCard } from '../../actions/general/close-popups.js';
import { moveCardBundle } from '../../actions/move-card-bundle/move-card-bundle.js';
import { mouseClick, oppContainer, oppContainerDocument, selfContainer, selfContainerDocument, systemState } from '../../front-end.js';
import { appendMessage } from '../chatbox/append-message.js';
import { determineUsername } from '../general/determine-username.js';
import { getZone } from '../zones/get-zone.js';
import { replayBlock } from "../../setup/general/replay-block.js";

export const identifyCard = (event) => {
    mouseClick.cardUser = event.target.user === 'self' ? 'self' : 'opp';
    mouseClick.zoneId = event.target.parentElement.id;
    if (!mouseClick.zoneId){ //this will be the case for cards on the active/bench, since they are wrapped in a container
        mouseClick.zoneId = event.target.parentElement.parentElement.id;
    };
    if (mouseClick.zoneId === 'deckCover'){
        mouseClick.cardIndex = 0;
    } else if (['lostZoneCover', 'discardCover'].includes(mouseClick.zoneId)){
        mouseClick.cardIndex = getZone(mouseClick.cardUser, mouseClick.zoneId).getCount() - 1;
    } else {
        mouseClick.cardIndex = getZone(mouseClick.cardUser, mouseClick.zoneId).array.findIndex(card => card.image === event.target);
    };
}

export const coverClick = (event) => {
    const selectedZone = getZone(event.target.user, event.target.id);
    if (selectedZone.elementCover) {
        selectedZone.element.style.display = 'block';
    };

    const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);

    if (event.target.id === 'deckCover' && notSpectator){
        appendMessage(systemState.initiator, determineUsername(systemState.initiator) + ' is looking through ' + determineUsername(event.target.user) + "'s deck", 'player');
    };
}

export const openCardContextMenu = (event) => {
    const cardContextMenu = document.getElementById('cardContextMenu');

    closeFullView(event);
    deselectCard();
    cardContextMenu.style.cssText = '';

    event.preventDefault();
    event.stopPropagation();

    identifyCard(event);

    const selfView = (selfContainerDocument.body.contains(event.target) && selfContainer.classList.contains('self')) || (!selfContainerDocument.body.contains(event.target) && !selfContainer.classList.contains('self'));
    const oppView = (!selfContainerDocument.body.contains(event.target) && selfContainer.classList.contains('self')) || (selfContainerDocument.body.contains(event.target) && !selfContainer.classList.contains('self'));
    
    const buttonConditions = {
        'abilityCounterButton': [[true, 'active'], [true, 'bench'], [true, 'stadium'], [true, 'discard']],
        'damageCounterButton': [[true, 'active'], [true, 'bench']],
        'specialConditionButton': [[true, 'active']],
        'shufflePrizesButton': [[selfView, 'prizes']],
        'lookPrizesButton': [[true, 'prizes']],
        'revealHidePrizesButton': [[true, 'prizes']],
        'lookHandButton': [[oppView, 'hand']],
        'randomHandButton': [[oppView, 'hand']],
        'shuffleDeckButton': [[true, 'deckCover']],
        'drawButton': [[selfView, 'deckCover']],
        'viewTopButton': [[true, 'deckCover']],
        'viewBottomButton': [[true, 'deckCover']],
        'discardHandButton': [[selfView, 'hand']],
        'shuffleHandButton': [[selfView, 'hand']],
        'shuffleHandBottomButton': [[selfView, 'hand']],
        'prizesHeader': [[true, 'prizes']],
        'handHeader': [[true, 'hand']],
        'deckHeader': [[true, 'deckCover']],
        'boardHeader': [[true, 'board']],
        'discardBoardButton': [[true, 'board']],
        'handBoardButton': [[true, 'board']],
        'shuffleBoardButton': [[true, 'board']],
        'lostZoneBoardButton': [[true, 'board']],
        'changeButton': [[true, 'active'], [true, 'bench']]
    };    
    
    for (const [buttonId, conditionsArray] of Object.entries(buttonConditions)){
        const button = document.getElementById(buttonId);
      
        // Check each condition array
        const shouldDisplay = conditionsArray.some(conditions => {
            const [userCondition, containerCondition] = conditions;
            return userCondition && !replayBlock("contextMenu",buttonId) && containerCondition === mouseClick.zoneId;
        });
        button.style.display = shouldDisplay ? 'block' : 'none';
    };
    document.getElementById("moveButton").style.display = !replayBlock("contextMenu","moveButton") ? 'block' : 'none';

    const atLeastOneButtonVisible = Array.from(cardContextMenu.children).some(button => button.style.display !== 'none');
    
    // Set the display property based on the visibility of buttons
    cardContextMenu.style.display = (atLeastOneButtonVisible && !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer)) ? 'block' : 'none';

    // get the position of the context menu
    const targetRect = event.target.getBoundingClientRect();
    const offsetHeight = window.innerHeight - ((event.target.user === 'self') ? selfContainer.offsetHeight : oppContainer.offsetHeight);
    if (document.body.contains(event.target)){
        cardContextMenu.style.left = `${targetRect.left + event.target.clientWidth}px`;
        cardContextMenu.style.top = `${targetRect.top}px`;
    } else if (selfView){
        if (event.target.parentElement.id === 'deckCover' || event.target.parentElement.id === 'discardCover'){
            cardContextMenu.style.left = `${targetRect.left - cardContextMenu.clientWidth}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight}px`; 
        } else if (event.target.parentElement.id === 'hand'){
            cardContextMenu.style.left = `${targetRect.left}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight}px`; 
        } else {
            cardContextMenu.style.left = `${targetRect.left + event.target.clientWidth}px`;
            cardContextMenu.style.top = `${targetRect.top + offsetHeight}px`; 
        };
    } else if (oppView){
        const adjustment = (document.body.offsetWidth - oppContainer.offsetWidth);
        if (event.target.parentElement.id === 'deckCover' || event.target.parentElement.id === 'discardCover'){
            cardContextMenu.style.right = `${targetRect.left + adjustment - cardContextMenu.clientWidth}px`;
            cardContextMenu.style.bottom = `${targetRect.top + offsetHeight - cardContextMenu.offsetHeight + event.target.offsetHeight}px`;
        } else if (event.target.parentElement.id === 'prizes' || event.target.parentElement.id === 'lostZoneCover'){
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
        const dZoneId = event.target.parentElement.parentElement.id;
        const targetIndex = getZone(event.target.user, dZoneId).array.findIndex(card => card.image === event.target);
        moveCardBundle(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, dZoneId, mouseClick.cardIndex, targetIndex, 'move');
    } else {
        closePopups(event); //need both because of highlights condition in the if block above
        identifyCard(event);
        mouseClick.card.image.classList.add('highlight');
        mouseClick.selectingCard = true;
    };
}

export const doubleClick = (event) => {
    if (event){
        identifyCard(event);
    };
    const targetImage = mouseClick.card.image;
    targetImage.classList.remove('highlight');
    if (['active', 'bench'].includes(mouseClick.zoneId) && !targetImage.parentElement.classList.contains('full-view')){
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
            targetImage.parentElement.classList.add('dark-mode-5'); //dynamically add dark-mode 
        };
        targetImage.parentElement.style.zIndex = '2';
        targetImage.parentElement.style.height = '70%';
        targetImage.parentElement.style.width = '69%';

        targetImage.parentElement.parentElement.style.zIndex = '2';
        document.getElementById('stadium').style.zIndex = '-1';
    } else {
        let overlay = document.createElement('div');
        overlay.id = 'fullImage';
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
        const documentArray = [selfContainerDocument, oppContainerDocument, document];
        documentArray.forEach(document => document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' || event.key === 'v') {
                removeOverlay();
            };
        }));
    };
}