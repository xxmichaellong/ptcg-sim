import { moveToDeckTop } from '../actions/zones/deck-actions.js';
import { closePopups } from '../actions/general/close-popups.js';
import { moveCard } from '../actions/move-card-logic/move-card.js';
import { activeElement, attachedCardsElement, benchElement, deckElement, discardElement, lostZoneElement, oppActiveElement, oppAttachedCardsElement, oppBenchElement, oppContainerDocument, oppDeckElement, oppDiscardElement, oppLostZoneElement, oppViewCardsElement, sCard, selfContainerDocument, systemState, target, viewCardsElement } from '../front-end.js';
import { moveCardMessage } from '../setup/chatbox/move-card-message.js';
import { zoneElementToArray } from '../setup/zones/zone-element-to-array.js';
import { stringToVariable, variableToString } from '../setup/zones/zone-string-to-variable.js';
import { identifyCard } from './click-events.js';

const popupContainers = [lostZoneElement, discardElement, deckElement, attachedCardsElement, oppLostZoneElement, oppDiscardElement, oppAttachedCardsElement, oppDeckElement, viewCardsElement, oppViewCardsElement];

export const dragStart = (event) => {
    event.target.classList.add('high-zIndex');
    if (event.target.attached){
        event.target.style.opacity = '0';
    } else {
        event.target.style.opacity = '0.6';
    }
    if (!event.target.attached){
        event.target.parentElement.querySelectorAll('img').forEach(image => {
            if (image.attached){
                image.style.opacity = '0.2';
            };
        });
    };    

    closePopups(event);
    identifyCard(event);

    event.target.classList.add('dragging');

    if (popupContainers.includes(sCard.zoneElement)){
        sCard.zoneElement.style.opacity = '0%';
    };
    if (event.target.parentElement.classList.contains('full-view')){
        sCard.box = event.target.parentElement;
        sCard.boxParent = event.target.parentElement.parentElement;
        sCard.box.style.opacity = '0';
    };
}

export const dragOver = (event) => {
    event.preventDefault();
    const blockedClasses = ['self-circle', 'opp-circle', 'self-tab', 'opp-tab'];
    if (blockedClasses.some(className => event.target.classList.contains(className))) {
        event.target.style.pointerEvents = 'none';
    };
    if (popupContainers.includes(sCard.zoneElement)){
        sCard.zoneElement.style.zIndex = '-1';
    };
    if (event.target.classList.contains('full-view')){
        sCard.box.style.zIndex = '-1';
        sCard.boxParent.style.zIndex = '-1';
    };
    let draggedImage = document.querySelector('.dragging') || selfContainerDocument.querySelector('.dragging') || oppContainerDocument.querySelector('.dragging');

    const targetIsNotOwnContainer = event.target !== draggedImage.parentElement && event.target !== draggedImage.parentElement.parentElement;
    const targetIsContainer = event.target.tagName === 'DIV';
    const cardIsAttached = draggedImage.attached;
    const targetIsActiveOrBench = [activeElement, benchElement, oppActiveElement, oppBenchElement].includes(event.target);
    const targetParentIsActiveOrBench = [activeElement, benchElement, oppActiveElement, oppBenchElement].includes(event.target.parentElement.parentElement);
    const targetNotItself = event.target !== draggedImage;
    const targetIsAttached = event.target.attached;
    const cardIsFromActiveOrBench = [activeElement, benchElement, oppActiveElement, oppBenchElement].includes(draggedImage.parentElement.parentElement);
    const targetParentParentIsNotOwnContainer = event.target.parentElement.parentElement !== draggedImage.parentElement.parentElement;
    
    const movingValidCardToContainer = targetIsContainer && targetIsNotOwnContainer && (!cardIsAttached || !targetIsActiveOrBench);
    const attachingValidCard = (targetParentIsActiveOrBench && targetNotItself && !targetIsAttached && (targetParentParentIsNotOwnContainer || cardIsAttached))
    const targetIsNotBox = !event.target.classList.contains('full-view') && !event.target.classList.contains('play-container');

    if (targetIsNotBox && (movingValidCardToContainer || attachingValidCard)){
        if (event.target.id === 'boardElement'){
            event.target.classList.add('highlightBox');
        } else {
            event.target.classList.add('highlight');
        };
    };

    const targetParentIsNotOwnContainer = event.target.parentElement !== draggedImage.parentElement;
    const targetParentIsContainer = event.target.parentElement.tagName === 'DIV';

    if (targetIsNotBox && targetParentIsContainer && (!targetParentIsActiveOrBench || (cardIsFromActiveOrBench && !cardIsAttached))){
        if (targetParentIsActiveOrBench && cardIsFromActiveOrBench && targetParentParentIsNotOwnContainer){
            event.target.parentElement.parentElement.classList.add('highlight');
        } else if (!targetParentIsActiveOrBench && targetParentIsNotOwnContainer){
            if (event.target.parentElement.id === 'boardElement'){
                event.target.parentElement.classList.add('highlightBox');
            } else {
                event.target.parentElement.classList.add('highlight');
            };
        ;}
    };
}

export const dragLeave = (event) => {
    event.target.classList.remove('highlight', 'highlightBox'); 
    event.target.parentElement.classList.remove('highlight', 'highlightBox');
    event.target.parentElement.parentElement.classList.remove('highlight', 'highlightBox');
}

export const dragEnd = (event) => {
    const enablePointerEvents = (containerDocument, classNames) => {
        const counters = containerDocument.getElementsByClassName(...classNames);
        for (let i = 0; i < counters.length; i++) {
            counters[i].style.pointerEvents = 'auto';
        };
    };
    
    const classList = ['self-circle', 'opp-circle', 'self-tab', 'opp-tab'];
    enablePointerEvents(selfContainerDocument, classList);
    enablePointerEvents(oppContainerDocument, classList);
    
    event.target.classList.remove('dragging');
    if (event.target.parentElement){
        event.target.parentElement.classList.remove('highlight', 'highlightBox');
        event.target.parentElement.parentElement.classList.remove('highlight', 'highlightBox');
    };

    event.target.classList.remove('high-zIndex');
    event.target.style.opacity = '1';
    if (event.target.parentElement){
        event.target.parentElement.querySelectorAll('img').forEach(image => {
            if (image.attached){
                image.style.opacity = '1';
            };
        });
    };

    if (popupContainers.includes(sCard.zoneElement)){
        sCard.zoneElement.style.opacity = '1';
        sCard.zoneElement.style.zIndex = '9999';
    };
    if (sCard.box){
        sCard.box.style.opacity = '1';
        sCard.box.style.zIndex = '2';
        sCard.boxParent.style.zIndex = sCard.box.parentElement ? '2' : '0';
        // stadiumElement.style.zIndex = sCard.box.parentElement ? '-1' : '0';
        sCard.box = false;
        sCard.boxParent = false;
    };
}

export const drop = (event) => {
    event.preventDefault();

    const blockedClasses = ['self-circle', 'opp-circle', 'self-tab', 'opp-tab'];
    if (blockedClasses.some(className => event.target.classList.contains(className))) {
        event.target.style.pointerEvents = 'none';
    };

    event.target.classList.remove('highlight', 'highlightBox');
    event.target.parentElement.classList.remove('highlight', 'highlightBox');
    event.target.parentElement.parentElement.classList.remove('highlight', 'highlightBox');

    //reroute displays to actual element
    if (['deckCoverElement'].includes(sCard.zoneElementString)){
        const mapping = {
            'deckCoverElement': 'deckElement',
            'lostZoneCoverElement': 'lostZoneElement',
            'discardCoverElement': 'discardElement'
        };
        sCard.zoneElementString = mapping[sCard.zoneElementString];
    };

    let draggedImage = document.querySelector('.dragging') || selfContainerDocument.querySelector('.dragging') || oppContainerDocument.querySelector('.dragging');
    //reset opacity of attached cards
    draggedImage.parentElement.querySelectorAll('img').forEach(image => {
        if (image.attached){
            image.style.opacity = '1';
        };
    });

    const targetIsNotBox = !event.target.classList.contains('full-view') && !event.target.classList.contains('play-container');
    //make sure only card images can trigger drop
    if (targetIsNotBox && draggedImage.layer !== undefined && (!event.target.attached || event.target.tagName === 'DIV')){
        // if target image exists and it isn't itself 
        if (event.target.tagName === 'IMG' && event.target !== draggedImage[0] && ['benchElement', 'activeElement'].includes(event.target.parentElement.parentElement.id)){
            target.zoneElementString = event.target.parentElement.parentElement.id;
            target.zoneArray = zoneElementToArray(sCard.user, target.zoneElementString);

            target.index = target.zoneArray.findIndex(card => card.image === event.target);
        } else if (event.target.tagName === 'IMG'){
            target.zoneElementString = event.target.parentElement.id;
            target.index = undefined;
        } else {
            target.zoneElementString = event.target.id;
            target.index = undefined;
        };
        
        target.zoneElement = stringToVariable(sCard.user, target.zoneElementString);
        target.zoneArray = zoneElementToArray(sCard.user, target.zoneElementString);
        target.zoneArrayString = variableToString(sCard.user, target.zoneArray);

        //reroute displays to actual zone element
        if (['deckCoverElement', 'lostZoneCoverElement', 'discardCoverElement'].includes(target.zoneElementString)){
            const mapping = {
                'deckCoverElement': 'deckElement',
                'lostZoneCoverElement': 'lostZoneElement',
                'discardCoverElement': 'discardElement'
            };
            target.zoneElementString = mapping[target.zoneElementString];
        };

        if ((sCard.zoneElementString !== target.zoneElementString || draggedImage.attached) && !(draggedImage.attached && ['benchElement', 'activeElement'].includes(target.zoneElementString) && target.index === undefined)){
            if (target.zoneArrayString === 'deckArray'){
                moveToDeckTop();
            } else {
                moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, target.zoneArrayString, 'move', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
                moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, target.zoneArrayString, target.zoneElementString, sCard.index, target.index);
            };
        };
    };
    event.stopPropagation();
}