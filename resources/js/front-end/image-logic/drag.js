import { sCard, discard_html, lostzone_html, deck_html, selfContainersDocument, stadium_html, target, attachedCardPopup_html, active_html, bench_html, viewCards_html } from "../setup/self-initialization.js";
import { containerIdToLocation } from "../setup/container-reference.js"
import { stringToVariable, variableToString } from "../setup/string-to-variable.js";
import { moveCard } from "./move-card.js";
import { socket } from "../setup/socket.js";
import { oppActive_html, oppAttachedCardPopup_html, oppBench_html, oppContainersDocument, oppDeck_html, oppDiscard_html, oppLostzone_html, oppViewCards_html } from "../setup/opp-initialization.js";
import { roomId } from "../start-page/generate-id.js";
import { closeContainerPopups, closePopups } from "../setup/close-popups.js";
import { identifyCard } from "./click-events.js";

// Add this function to initiate the drag operation
export function dragStart(event){
    closePopups();

    identifyCard(event);

    event.target.classList.add('dragging');

    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html, oppLostzone_html, oppDiscard_html, oppAttachedCardPopup_html, oppDeck_html, viewCards_html, oppViewCards_html].includes(sCard.container)){
        sCard.container.style.opacity = '0%';
    };
}

export function dragOver(event){
    event.preventDefault();
    if (event.target.classList.contains('circle')) {
        event.target.style.pointerEvents = 'none';
    };

    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html, oppLostzone_html, oppDiscard_html, oppAttachedCardPopup_html, oppDeck_html, viewCards_html, oppViewCards_html].includes(sCard.container)){
        sCard.container.style.zIndex = '-1';
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
        event.target.classList.add('highlight');
    };

    const targetParentIsNotOwnContainer = event.target.parentElement !== draggedImage.parentElement && event.target.parentElement.parentElement !== draggedImage.parentElement.parentElement;
    const targetParentIsContainer = event.target.parentElement.tagName === 'DIV'

    if (targetParentIsContainer && targetParentIsNotOwnContainer && (!targetParentIsActiveOrBench || (cardIsFromActiveOrBench && !cardIsAttached))){
        if (['bench_html', 'active_html'].includes(draggedImage.parentElement.parentElement.id)){
            event.target.parentElement.parentElement.classList.add('highlight');
        } else {
            event.target.parentElement.classList.add('highlight');
        }
    };
}

export function dragLeave(event){
    event.target.classList.remove('highlight'); 
    event.target.parentElement.classList.remove('highlight');
    event.target.parentElement.parentElement.classList.remove('highlight');
}

export function dragEnd(event){
    let damageCounters = selfContainersDocument.getElementsByClassName('circle');
    for (let i = 0; i < damageCounters.length; i++) {
        damageCounters[i].style.pointerEvents = 'auto';
    };
    damageCounters = oppContainersDocument.getElementsByClassName('circle');
    for (let i = 0; i < damageCounters.length; i++) {
        damageCounters[i].style.pointerEvents = 'auto';
    };

    event.target.classList.remove('dragging');
    event.target.parentElement.classList.remove('highlight');
    event.target.parentElement.parentElement.classList.remove('highlight');

    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html, oppLostzone_html, oppDiscard_html, oppAttachedCardPopup_html, oppDeck_html, viewCards_html, oppViewCards_html].includes(sCard.container)){
        sCard.container.style.opacity = '1';
        sCard.container.style.zIndex = '9999';    
    };
}

// Add this function to handle the drop operation
export function drop(event){
    event.preventDefault();
    if (event.target.classList.contains('circle')) {
        event.target.style.pointerEvents = 'none';
    };
    event.target.classList.remove('highlight');
    event.target.parentElement.classList.remove('highlight');
    event.target.parentElement.parentElement.classList.remove('highlight');

    //reroute displays to actual container
    if (['deckDisplay_html'].includes(sCard.containerId)){
        const mapping = {
            'deckDisplay_html': 'deck_html',
        };
        sCard.containerId = mapping[sCard.containerId];
    };

    let draggedImage = document.querySelector('.dragging') || selfContainersDocument.querySelector('.dragging') || oppContainersDocument.querySelector('.dragging');

    //make sure only card images can trigger drop
    if (draggedImage.layer !== undefined && (!event.target.attached || event.target.tagName === 'DIV')){
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
            moveCard(sCard.user, sCard.locationAsString, sCard.containerId, target.locationAsString, target.containerId, sCard.index, target.index);
            socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, target.locationAsString, target.containerId, sCard.index, target.index);
            closeContainerPopups();
        };
    };
    event.stopPropagation();
}