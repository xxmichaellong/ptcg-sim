import { deck, deck_html, colresssExperimentZone } from "../setup/initialization.js";
import { moveCard } from "../image-logic/move-card.js";

export const colresssExperimentZone_html = document.getElementById('colresssExperimentZone_html');
export function colresssExperiment(){
    // close flowerSelectingpopup
    colresssExperimentPopup.style.display = "none";
 
    // create HTML container to temporarily hold flowerselecting cards
    colresssExperimentZone_html.style.display = 'block';
  
    let i = 0;
    while (deck.count > 0 && i < 5){
        moveCard(deck, deck_html, colresssExperimentZone, colresssExperimentZone_html, 0);
        i++;
    };

    colresssExperimentZone.images.forEach(image => {
        image.style.display = 'inline-block';
    });

    if (colresssExperimentZone.childElementCount === 0)
        colresssExperimentZone_html.style.display = 'none';
}