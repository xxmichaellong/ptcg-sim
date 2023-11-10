import { selectedCard, discard_html, lostzone_html, deck_html, mainContainersDocument, stadium_html } from "../setup/initialization.js";
import { containerToLocation } from "../setup/container-reference.js"
import { moveEventTarget } from "./move-event-target.js";
import { colresssExperimentZone_html } from "../card-logic/colress's-experiment.js";
import { flowerSelectingZone_html } from "../card-logic/flower-selecting.js";


// Add this function to initiate the drag operation
export function dragStart(event){
    event.target.classList.add('dragging');
    const containerId = event.target.parentElement.id;
    selectedCard.location = containerToLocation[containerId];
  
    if (containerId === 'prizesHidden_html' || containerId === 'deckDisplay_html'){
        selectedCard.index = 0;
    }
    else
        selectedCard.index = selectedCard.location.images.indexOf(event.target);

    // Find the parent element by ID
    if (containerId === 'stadium_html' || containerId === 'colresssExperimentZone_html' || containerId === 'flowerSelectingZone_html'){
        selectedCard.container = document.getElementById(containerId);
    }
    else
        selectedCard.container = mainContainersDocument.getElementById(containerId);
    
    if (selectedCard.container === lostzone_html || selectedCard.container === discard_html || selectedCard.container === deck_html){
        selectedCard.container.style.opacity = '0';
    };
}

export function dragOver(){
    if (selectedCard.container === lostzone_html || selectedCard.container === discard_html || selectedCard.container === deck_html){
        selectedCard.container.style.zIndex = '-1';
    };
}

export function dragEnd(event){
    event.target.classList.remove('dragging');
    if (selectedCard.container === lostzone_html || selectedCard.container === discard_html || selectedCard.container === deck_html){
        selectedCard.container.style.opacity = '1';
        selectedCard.container.style.zIndex = '9999';    
    };  
}

// Add this function to allow dropping in the hand container
export function allowDrop(event){
    event.preventDefault();
}

// Add this function to handle the drop operation
export function drop(event){
    event.preventDefault();

    let draggedImage;
    if (selectedCard.container === stadium_html || selectedCard.container === colresssExperimentZone_html || selectedCard.container === flowerSelectingZone_html){
        draggedImage = document.querySelectorAll('.dragging');
    }
    else
        draggedImage = mainContainersDocument.querySelectorAll('.dragging');
//make sure only card images can trigger drop
    if (draggedImage[0].layer !== 'undefined'){

        const targetImage = event.target.closest('img');
        let containerId;

        if (targetImage && targetImage !== draggedImage && (event.target.parentElement.id === 'bench_html' || event.target.parentElement.id === 'active_html')){
            containerId = event.target.parentElement.id;
        }
        else
            containerId = event.target.id;

        const mLocation = containerToLocation[containerId];
        moveEventTarget(selectedCard, mLocation, targetImage);
    };

    event.stopPropagation();
}