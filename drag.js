import { selectedCard, prizes } from "./initialization.js";
import { containerToLocation } from "./containerReference.js"
import { moveEventTarget } from "./moveEventTarget.js";

// Add this function to initiate the drag operation
export function dragStart(event) {
    const containerId = event.target.parentElement.id;
    selectedCard.location = containerToLocation[containerId];
  
    if (selectedCard.location === prizes && containerId === 'prizesHidden_html') {
      selectedCard.index = 0;
    } else {
      selectedCard.index = selectedCard.location.images.indexOf(event.target);
    }
    // Find the parent element by ID
    selectedCard.container = document.getElementById(containerId);
    selectedCard.container.style.opacity = "0.2";
}

export function dragOver(){
    selectedCard.container.style.zIndex = "-1";
}

export function dragEnd(){
    selectedCard.container.style.opacity = "1";
    selectedCard.container.style.zIndex = "9999";
}

// Add this function to allow dropping in the hand container
export function allowDrop(event) {
    event.preventDefault();
}

// Add this function to handle the drop operation
export function drop(event) {
    event.preventDefault();
        
    const containerId = event.target.id;
    const mLocation = containerToLocation[containerId];
    moveEventTarget(selectedCard, mLocation);

    event.stopPropagation();
}