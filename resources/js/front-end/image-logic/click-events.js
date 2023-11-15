import { discardDisplay_html, lostzoneDisplay_html, prizes, selectedCard, } from "../setup/initialization.js";
import { containerIdToLocation } from "../setup/container-reference.js";
import { deck_html, lostzone_html, discard_html } from "../setup/initialization.js";
import { oppDiscard_html, oppLostzone_html } from "../setup/opp-initialization.js";

// Function to display the popup when the image is clicked
export function imageClick(event){

     //style the popup when image is clicked
     const cardPopup = document.getElementById('cardPopup');
     cardPopup.style.display = 'block';

    //identify index of the card/image
    const containerId = event.target.parentElement.id;
    selectedCard.location = containerIdToLocation[containerId];
    selectedCard.container = document.getElementById(containerId);
  
    selectedCard.index = selectedCard.location.cards.findIndex(card => card.image === event.target);

    //handle popups for specific cards

    //pokestop popup
    if (selectedCard.location.cards[selectedCard.index].name === 'pokestop'){
      const pokestopPopup = document.getElementById('pokestopPopup');
      pokestopPopup.style.display = 'block';
      pokestopPopup.style.top = "40%";
    };
    //flowerselectingpopup
    if (selectedCard.location.cards[selectedCard.index].name === 'comfey'){
      const flowerSelectingPopup = document.getElementById('flowerSelectingPopup');
      flowerSelectingPopup.style.display = 'block';
      flowerSelectingPopup.style.top = "40%";
    };

    //colresssexperiment popup
    if (selectedCard.location.cards[selectedCard.index].name === 'colress\'sExperiment'){
      const colresssExperimentPopup = document.getElementById('colresssExperimentPopup');
      colresssExperimentPopup.style.display = 'block';
      colresssExperimentPopup.style.top = "40%";
    };
}

export function deckCoverClick(){
  deck_html.style.display = 'block';
};

export function discardCoverClick(event){
  if (event.target.parentElement === discardDisplay_html){
    discard_html.style.display = 'block';
  } else
    oppDiscard_html.style.display = 'block';
};

export function lostzoneCoverClick(event){
  if (event.target.parentElement === lostzoneDisplay_html){
    lostzone_html.style.display = 'block';
  } else
    oppLostzone_html.style.display = 'block';
};