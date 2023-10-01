import { selectedCard } from "./initialization.js";

export function moveCard(oLocation, oLocation_html, mLocation, mLocation_html){
    
        // remove card from hand.cards array and add it to bench.cards array
        mLocation.cards.push(...oLocation.cards.splice(selectedCard.index, 1));
    
        // remove image from hand.images array and add it to bench.images array
        mLocation.images.push(...oLocation.images.splice(selectedCard.index, 1));

        // remove image from hand_html container
        oLocation_html.removeChild(mLocation.images[mLocation.count-1]);

        // append image to bench_html container
        mLocation_html.appendChild(mLocation.images[mLocation.count-1]);

        //remove popup
        popup.style.display = "none";
    }