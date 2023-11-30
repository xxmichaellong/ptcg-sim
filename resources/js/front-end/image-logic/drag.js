import { selectedCard, discard_html, lostzone_html, deck_html, selfContainersDocument, stadium_html, target, attachedCardPopup_html, active_html, bench_html } from "../setup/initialization.js";
import { containerIdToLocation } from "../setup/container-reference.js"
import { stringToVariable, variableToString } from "../setup/string-to-variable.js";
import { moveCard } from "./move-card.js";
import { socket } from "../setup/socket.js";
import { oppActive_html, oppAttachedCardPopup_html, oppBench_html, oppContainersDocument, oppDeck_html, oppDiscard_html, oppLostzone_html } from "../setup/opp-initialization.js";
import { roomId } from "../start-page/generate-id.js";
import { closePopups } from "../setup/close-popups.js";

// Add this function to initiate the drag operation
export function dragStart(event){
    closePopups();

    event.target.classList.add('dragging');

    if (event.target.user === 'self'){
        selectedCard.oUser = 'opp';
        selectedCard.user = 'self';
    } else {
        selectedCard.oUser = 'self';
        selectedCard.user = 'opp';
    };

    selectedCard.containerId = event.target.parentElement.id;
    selectedCard.container = stringToVariable(selectedCard.user, selectedCard.containerId);
    selectedCard.location = containerIdToLocation(selectedCard.user, selectedCard.containerId);
    selectedCard.locationAsString = variableToString(selectedCard.user, selectedCard.location);
  
    if (selectedCard.containerId === 'deckDisplay_html'){
        selectedCard.index = 0;
    } else
        selectedCard.index = selectedCard.location.cards.findIndex(card => card.image === event.target);
    
    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html, oppLostzone_html, oppDiscard_html, oppAttachedCardPopup_html, oppDeck_html].includes(selectedCard.container)){
        selectedCard.container.style.opacity = '0%';
    };

    //reroute displays to actual container
    if (['deckDisplay_html'].includes(selectedCard.containerId)){
    const mapping = {
        'deckDisplay_html': 'deck_html',
    };
        selectedCard.containerId = mapping[selectedCard.containerId];
    };
}

export function dragOver(event){
    event.preventDefault();
    if (event.target.classList.contains('circle')) {
        event.target.style.pointerEvents = 'none';
    };

    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html, oppLostzone_html, oppDiscard_html, oppAttachedCardPopup_html, oppDeck_html].includes(selectedCard.container)){
        selectedCard.container.style.zIndex = '-1';
    };
    if (event.target.tagName === 'DIV' || ([active_html, bench_html, oppActive_html, oppBench_html].includes(event.target.parentElement)
    && !event.target.classList.contains('dragging')
    && event.target.style.position === 'static')
    && ((selfContainersDocument.querySelector('.dragging') && ![active_html, bench_html].includes(selfContainersDocument.querySelector('.dragging').parentElement)) || (oppContainersDocument.querySelector('.dragging') && ![oppActive_html, oppBench_html].includes(oppContainersDocument.querySelector('.dragging').parentElement)))){
        event.target.classList.add('highlight');
    };
    if (event.target.parentElement.tagName === 'DIV' 
    && (![active_html, bench_html, oppActive_html, oppBench_html].includes(event.target.parentElement) 
    || ((selfContainersDocument.querySelector('.dragging') && [active_html, bench_html].includes(selfContainersDocument.querySelector('.dragging').parentElement)) || (oppContainersDocument.querySelector('.dragging') && [oppActive_html, oppBench_html].includes(oppContainersDocument.querySelector('.dragging').parentElement))))){
        event.target.parentElement.classList.add('highlight');
    }
}

export function dragLeave(event){
    event.target.classList.remove('highlight'); 
    event.target.parentElement.classList.remove('highlight');
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

    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html, oppLostzone_html, oppDiscard_html, oppAttachedCardPopup_html, oppDeck_html].includes(selectedCard.container)){
        selectedCard.container.style.opacity = '1';
        selectedCard.container.style.zIndex = '9999';    
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

    let draggedImage = document.querySelectorAll('.dragging');
    if (draggedImage.length === 0){
        draggedImage = selfContainersDocument.querySelectorAll('.dragging');
    }
    if (draggedImage.length === 0){
        draggedImage = oppContainersDocument.querySelectorAll('.dragging');
    };

//make sure only card images can trigger drop
    if (draggedImage[0].layer !== undefined){
        // if target image exists and it isn't itself 
        if (event.target.tagName === 'IMG' && event.target !== draggedImage[0] && ['bench_html', 'active_html'].includes(event.target.parentElement.id)){
            target.containerId = event.target.parentElement.id;
            target.location = containerIdToLocation(selectedCard.user, target.containerId);
            target.index = target.location.cards.findIndex(card => card.image === event.target);
        } else if (event.target.id === 'card'){
            target.containerId = event.target.parentElement.id;
            target.index = undefined;
        } else {
            target.containerId = event.target.id;
            target.index = undefined;
        };
        
        target.container = stringToVariable(selectedCard.user, target.containerId);
        target.location = containerIdToLocation(selectedCard.user, target.containerId);
        target.locationAsString = variableToString(selectedCard.user, target.location);

        //reroute displays to actual container
        if (['deckDisplay_html', 'lostzoneDisplay_html', 'discardDisplay_html'].includes(target.containerId)){
            const mapping = {
                'deckDisplay_html': 'deck_html',
                'lostzoneDisplay_html': 'lostzone_html',
                'discardDisplay_html': 'discard_html'
            };
            target.containerId = mapping[target.containerId];
        };
        moveCard(selectedCard.user, selectedCard.locationAsString, selectedCard.containerId, target.locationAsString, target.containerId, selectedCard.index, target.index);
        socket.emit('moveCard', roomId, selectedCard.oUser, selectedCard.locationAsString, selectedCard.containerId, target.locationAsString, target.containerId, selectedCard.index, target.index);
    };
    event.stopPropagation();
}