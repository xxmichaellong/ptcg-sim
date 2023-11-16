import { selectedCard, discard_html, lostzone_html, deck_html, selfContainersDocument, stadium_html, target, attachedCardPopup_html } from "../setup/initialization.js";
import { containerIdToLocation } from "../setup/container-reference.js"
import { stringToVariable, variableToString } from "../setup/string-to-variable.js";
import { moveCard } from "./move-card.js";
import { socket } from "../front-end.js";
import { oppAttachedCardPopup_html } from "../setup/opp-initialization.js";


// Add this function to initiate the drag operation
export function dragStart(event){
    event.target.classList.add('dragging');

    selectedCard.containerId = event.target.parentElement.id;
    selectedCard.container = stringToVariable('self', selectedCard.containerId);
    selectedCard.location = containerIdToLocation[selectedCard.containerId];
    selectedCard.locationAsString = variableToString(selectedCard.location);
  
    if (selectedCard.containerId === 'deckDisplay_html'){
        selectedCard.index = 0;
    } else
        selectedCard.index = selectedCard.location.cards.findIndex(card => card.image === event.target);
    
    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html].includes(selectedCard.container)){
        selectedCard.container.style.opacity = '0%';
    };

    //reroute displays to actual container
    if (['deckDisplay_html', 'lostzoneDisplay_html', 'discardDisplay_html', 'attachedCardPopup_html'].includes(selectedCard.containerId)){
    const mapping = {
        'deckDisplay_html': 'deck_html',
        'lostzoneDisplay_html': 'lostzone_html',
        'discardDisplay_html': 'discard_html',
        'attachedCardPopup_html': 'attachedCardPopup'
    };
        selectedCard.containerId = mapping[selectedCard.containerId];
    };
}

export function dragOver(event){
    event.preventDefault();
    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html].includes(selectedCard.container)){
        selectedCard.container.style.zIndex = '-1';
    };
}

export function dragEnd(event){
    event.target.classList.remove('dragging');
    if ([lostzone_html, discard_html, deck_html, attachedCardPopup_html].includes(selectedCard.container)){
        selectedCard.container.style.opacity = '1';
        selectedCard.container.style.zIndex = '9999';    
    };
}

// Add this function to handle the drop operation
export function drop(event){
    event.preventDefault();

    let draggedImage = document.querySelectorAll('.dragging');
    if (draggedImage.length === 0)
        draggedImage = selfContainersDocument.querySelectorAll('.dragging');
//make sure only card images can trigger drop
    if (draggedImage[0].layer !== undefined && draggedImage[0].user === 'self'){
        // if target image exists and it isn't itself 
        if (event.target.tagName === 'IMG' && event.target !== draggedImage[0] && ['bench_html', 'active_html'].includes(event.target.parentElement.id)){
            target.containerId = event.target.parentElement.id;
            target.location = containerIdToLocation[target.containerId];
            target.index = target.location.cards.findIndex(card => card.image === event.target);
        } else if (event.target.id === 'card'){
            target.containerId = event.target.parentElement.id;
            target.index = undefined;
        } else {
            target.containerId = event.target.id;
            target.index = undefined;
        };
        
        target.container = stringToVariable('self', target.containerId);
        target.location = containerIdToLocation[target.containerId];
        target.locationAsString = variableToString(target.location);

        //reroute displays to actual container
        if (['deckDisplay_html', 'lostzoneDisplay_html', 'discardDisplay_html'].includes(target.containerId)){
            const mapping = {
                'deckDisplay_html': 'deck_html',
                'lostzoneDisplay_html': 'lostzone_html',
                'discardDisplay_html': 'discard_html'
            };
            target.containerId = mapping[target.containerId];
        };

        // const mLocation = containerIdToLocation[containerId];
        // moveEventTarget(selectedCard, mLocation, targetImage);
        moveCard('self', selectedCard.locationAsString, selectedCard.containerId, target.locationAsString, target.containerId, selectedCard.index, target.index);
        socket.emit('moveCard', 'opp', selectedCard.locationAsString, selectedCard.containerId, target.locationAsString, target.containerId, selectedCard.index, target.index);
    };

    event.stopPropagation();
}