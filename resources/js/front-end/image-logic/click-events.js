import { deckDisplay_html, discardDisplay_html, lostzoneDisplay_html, prizes, selectedCard, selfContainersDocument, } from "../setup/initialization.js";
import { containerIdToLocation } from "../setup/container-reference.js";
import { deck_html, lostzone_html, discard_html } from "../setup/initialization.js";
import { oppDeck_html, oppDiscard_html, oppLostzone_html } from "../setup/opp-initialization.js";
import { stringToVariable, variableToString } from "../setup/string-to-variable.js";

// Function to display the popup when the image is clicked
/* export function imageClick(event){

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
*/
export const cardPopup = document.getElementById('cardPopup');

export function imageClick(event){
    if (selfContainersDocument.body.contains(event.target)){
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
    selectedCard.index = selectedCard.location.cards.findIndex(card => card.image === event.target);

    let damageCounterButton = document.getElementById('damageCounterButton');
    let specialConditionButton = document.getElementById('specialConditionButton')

    if (['active_html', 'bench_html'].includes(selectedCard.containerId)){
        damageCounterButton.style.display = 'block';
    } else {
        damageCounterButton.style.display = 'none';
    };

    if (['active_html'].includes(selectedCard.containerId)){
        specialConditionButton.style.display = 'block';
    } else {
        specialConditionButton.style.display = 'none';
    };


    cardPopup.style.display = 'block';
}

export function deckCoverClick(event){
    if (event.target.parentElement === deckDisplay_html){
        deck_html.style.display = 'block';
    } else
		oppDeck_html.style.display = 'block';
}

export function discardCoverClick(event){
    if (event.target.parentElement === discardDisplay_html){
        discard_html.style.display = 'block';
    } else
        oppDiscard_html.style.display = 'block';
}

export function lostzoneCoverClick(event){
  if (event.target.parentElement === lostzoneDisplay_html){
      lostzone_html.style.display = 'block';
  } else
      oppLostzone_html.style.display = 'block';
}