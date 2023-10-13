import { prizes, selectedCard, } from "./initialization.js";
import { containerToLocation } from "./containerReference.js";

// Function to display the popup when the image is clicked
export function imageClick(event){

     //style the popup when image is clicked
     var popup = document.getElementById('popup');
     popup.style.display = 'block';

    //identify index of the card/image
    const containerId = event.target.parentElement.id;
    selectedCard.location = containerToLocation[containerId];
  
    if (selectedCard.location === prizes && containerId === 'prizesHidden_html') {
      selectedCard.index = 0;
    } else {
      selectedCard.index = selectedCard.location.images.indexOf(event.target);
    }
}