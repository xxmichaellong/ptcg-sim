import { prizes, selectedCard, } from "./initialization.js";
import { containerToLocation } from "./containerReference.js";

// Function to display the popup when the image is clicked
export function imageClick(event){

     //style the popup when image is clicked
     const cardPopup = document.getElementById('cardPopup');
     cardPopup.style.display = 'block';

    //identify index of the card/image
    const containerId = event.target.parentElement.id;
    selectedCard.location = containerToLocation[containerId];
    selectedCard.container = document.getElementById(containerId);
  
    if (selectedCard.location === prizes && containerId === 'prizesHidden_html') {
      selectedCard.index = 0;
    } else {
      selectedCard.index = selectedCard.location.images.indexOf(event.target);
    };

    //handle popups for specific cards

    //pokestop popup
    if (selectedCard.location.cards[selectedCard.index].name === 'pokestop'){
      const pokestopPopup = document.getElementById('pokestopPopup');
      pokestopPopup.style.display = 'block';
      pokestopPopup.style.top = "40%";
    };
}