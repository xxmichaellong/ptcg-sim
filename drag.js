import { selectedCard, prizes, discard_html, lostzone_html, deck_html } from "./initialization.js";
import { containerToLocation } from "./containerReference.js"
import { moveEventTarget } from "./moveEventTarget.js";

// Add this function to initiate the drag operation
export function dragStart(event) {
    event.target.classList.add('dragging');
    const containerId = event.target.parentElement.id;
    selectedCard.location = containerToLocation[containerId];
  
    if (selectedCard.location === prizes && containerId === 'prizesHidden_html') {
      selectedCard.index = 0;
    } else {
      selectedCard.index = selectedCard.location.images.indexOf(event.target);
    }
    // Find the parent element by ID
    selectedCard.container = document.getElementById(containerId);
    if (selectedCard.container === lostzone_html || selectedCard.container === discard_html || selectedCard.container === deck_html){
        selectedCard.container.style.opacity = "0";
    };
}

export function dragOver(){
    if (selectedCard.container === lostzone_html || selectedCard.container === discard_html || selectedCard.container === deck_html){
        selectedCard.container.style.zIndex = "-1";
    };
}

export function dragEnd(event){
    event.target.classList.remove('dragging');
    const containers = [lostzone_html, discard_html, deck_html];
    for (const container of containers) {
      container.style.opacity = "1";
      container.style.zIndex = "9999";
    };    
}

// Add this function to allow dropping in the hand container
export function allowDrop(event) {
    event.preventDefault();
}

// Add this function to handle the drop operation
export function drop(event) {
    event.preventDefault();
    const draggedImage = document.querySelectorAll('.dragging');

//make sure only card images can trigger drop
    if (draggedImage[0].layer !== 'undefined'){

        const targetImage = event.target.closest('img');
        let containerId = event.target.id;

        if (targetImage && targetImage !== document.querySelector('.dragging') && (event.target.parentElement.id === 'bench_html' || event.target.parentElement.id === 'active_html')) {
            containerId = event.target.parentElement.id;
        }

        const mLocation = containerToLocation[containerId];
        moveEventTarget(selectedCard, mLocation, targetImage);
    }

    event.stopPropagation();
}