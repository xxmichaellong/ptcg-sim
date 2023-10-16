import { deck, deck_html, flowerSelectingZone } from "./initialization.js";
import { moveCard } from "./moveCard.js";

export function flowerSelecting(){
    // close flowerSelectingpopup
    flowerSelectingPopup.style.display = "none";
 
    // create HTML container to temporarily hold flowerselecting cards
    const flowerSelectingZone_html = document.getElementById('flowerSelectingZone_html');
    flowerSelectingZone_html.style.display = 'block';
  
    let i = 0;
    while (deck.count > 0 && i < 2){
        moveCard(deck, deck_html, flowerSelectingZone, flowerSelectingZone_html, 0);
        i++;
    };

    flowerSelectingZone.images.forEach(image => {
        image.style.display = 'inline-block';
    });

    if (flowerSelectingZone.childElementCount === 0)
        flowerSelectingZone_html.style.display = 'none';
}