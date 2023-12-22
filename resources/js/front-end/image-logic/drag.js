import { closePopups } from '../actions/general/close-popups.js';
import { moveCard } from '../actions/general/move-card.js';
import { active_html, attachedCardPopup_html, bench_html, deck_html, discard_html, lostzone_html, oppActive_html, oppAttachedCardPopup_html, oppBench_html, oppContainersDocument, oppDeck_html, oppDiscard_html, oppLostzone_html, oppViewCards_html, sCard, selfContainersDocument, target, viewCards_html } from '../front-end.js';
import { moveCardMessage } from '../setup/chatbox/location-name.js';
import { containerIdToLocation } from '../setup/containers/container-reference.js';
import { stringToVariable, variableToString } from '../setup/containers/string-to-variable.js';
import { identifyCard } from './click-events.js';

const popupContainers = [lostzone_html, discard_html, deck_html, attachedCardPopup_html, oppLostzone_html, oppDiscard_html, oppAttachedCardPopup_html, oppDeck_html, viewCards_html, oppViewCards_html];

export const dragStart = (event) => {
    closePopups(event);
    identifyCard(event);

    event.target.classList.add('dragging');

    if (popupContainers.includes(sCard.container)){
        sCard.container.style.opacity = '0%';
    };
    if (event.target.parentElement.classList.contains('fullView')){
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
    if (popupContainers.includes(sCard.container)){
        sCard.container.style.zIndex = '-1';
    };
    if (event.target.classList.contains('fullView')){
        sCard.box.style.zIndex = '-1';
        sCard.boxParent.style.zIndex = '-1';
    };
    let draggedImage = document.querySelector('.dragging') || selfContainersDocument.querySelector('.dragging') || oppContainersDocument.querySelector('.dragging');

    const targetIsNotOwnContainer = event.target !== draggedImage.parentElement && event.target !== draggedImage.parentElement.parentElement;
    const targetIsContainer = event.target.tagName === 'DIV';
    const cardIsAttached = draggedImage.attached;
    const targetIsActiveOrBench = [active_html, bench_html, oppActive_html, oppBench_html].includes(event.target);
    const targetParentIsActiveOrBench = [active_html, bench_html, oppActive_html, oppBench_html].includes(event.target.parentElement.parentElement);
    const targetNotItself = event.target !== draggedImage;
    const targetIsAttached = event.target.attached;
    const cardIsFromActiveOrBench = [active_html, bench_html, oppActive_html, oppBench_html].includes(draggedImage.parentElement.parentElement);

    const movingValidCardToContainer = targetIsContainer && targetIsNotOwnContainer && (!cardIsAttached || !targetIsActiveOrBench);
    const attachingValidCard = (targetParentIsActiveOrBench && targetNotItself && !targetIsAttached && (!cardIsFromActiveOrBench || cardIsAttached))

    if (movingValidCardToContainer || attachingValidCard){
        if (event.target.id === 'board_html'){
            event.target.classList.add('highlightBox');
        } else {
            event.target.classList.add('highlight');
        };
    };

    const targetParentIsNotOwnContainer = event.target.parentElement !== draggedImage.parentElement
    const targetParentParentIsNotOwnContainer = event.target.parentElement.parentElement !== draggedImage.parentElement.parentElement;
    const targetParentIsContainer = event.target.parentElement.tagName === 'DIV'
    const targetIsNotBox = !event.target.classList.contains('fullView') && !event.target.classList.contains('playContainer') 

    if (targetIsNotBox && targetParentIsContainer && (!targetParentIsActiveOrBench || (cardIsFromActiveOrBench && !cardIsAttached))){
        if (targetParentIsActiveOrBench && cardIsFromActiveOrBench && targetParentParentIsNotOwnContainer){
            event.target.parentElement.parentElement.classList.add('highlight');
        } else if (!targetParentIsActiveOrBench && targetParentIsNotOwnContainer){
            if (event.target.parentElement.id === 'board_html'){
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
    enablePointerEvents(selfContainersDocument, classList);
    enablePointerEvents(oppContainersDocument, classList);
    
    event.target.classList.remove('dragging');
    event.target.parentElement.classList.remove('highlight', 'highlightBox');
    event.target.parentElement.parentElement.classList.remove('highlight', 'highlightBox');

    if (popupContainers.includes(sCard.container)){
        sCard.container.style.opacity = '1';
        sCard.container.style.zIndex = '9999';    
    };
    if (sCard.box){
        sCard.box.style.opacity = '1';
        sCard.box.style.zIndex = '2';
        sCard.boxParent.style.zIndex = sCard.box.parentElement ? '2' : '0';
        stadium_html.style.zIndex = sCard.box.parentElement ? '-1' : '0';
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

    //reroute displays to actual container
    if (['deckDisplay_html'].includes(sCard.containerId)){
        const mapping = {
            'deckDisplay_html': 'deck_html',
        };
        sCard.containerId = mapping[sCard.containerId];
    };

    let draggedImage = document.querySelector('.dragging') || selfContainersDocument.querySelector('.dragging') || oppContainersDocument.querySelector('.dragging');

    const targetIsNotBox = !event.target.classList.contains('fullView') && !event.target.classList.contains('playContainer') 
    //make sure only card images can trigger drop
    if (targetIsNotBox && draggedImage.layer !== undefined && (!event.target.attached || event.target.tagName === 'DIV')){
        // if target image exists and it isn't itself 
        if (event.target.tagName === 'IMG' && event.target !== draggedImage[0] && ['bench_html', 'active_html'].includes(event.target.parentElement.parentElement.id)){
            target.containerId = event.target.parentElement.parentElement.id;
            target.location = containerIdToLocation(sCard.user, target.containerId);

            target.index = target.location.cards.findIndex(card => card.image === event.target);
        } else if (event.target.id === 'card'){
            target.containerId = event.target.parentElement.id;
            target.index = undefined;
        } else {
            target.containerId = event.target.id;
            target.index = undefined;
        };
        
        target.container = stringToVariable(sCard.user, target.containerId);
        target.location = containerIdToLocation(sCard.user, target.containerId);
        target.locationAsString = variableToString(sCard.user, target.location);

        //reroute displays to actual container
        if (['deckDisplay_html', 'lostzoneDisplay_html', 'discardDisplay_html'].includes(target.containerId)){
            const mapping = {
                'deckDisplay_html': 'deck_html',
                'lostzoneDisplay_html': 'lostzone_html',
                'discardDisplay_html': 'discard_html'
            };
            target.containerId = mapping[target.containerId];
        };

        if ((sCard.containerId !== target.containerId || draggedImage.attached) && !(draggedImage.attached && ['bench_html', 'active_html'].includes(target.containerId) && target.index === undefined)){
            moveCardMessage(sCard.locationAsString, target.locationAsString, 'move', sCard.card.image.attached);
            moveCard(sCard.user, sCard.locationAsString, sCard.containerId, target.locationAsString, target.containerId, sCard.index, target.index);
        };
    };
    event.stopPropagation();
}