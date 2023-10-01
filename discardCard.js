import { hand_html, hand, discard, discard_html, prizes, prizes_html, lostzone, lostzone_html, 
    bench, bench_html, active, active_html, stadium, stadium_html, deck_html, deck, selectedCard } from "./initialization.js";

export function discardCard(){
    
    if (selectedCard.location === 'hand'){

        //function to remove card from hand array and add it to discard array
        discard.cards.push(...hand.cards.splice(selectedCard.index, 1));
    
        //function to remove image of card from hand container
        hand_html.removeChild(hand.images[selectedCard.index]);

        //Add to discard pile
        const imgElement = document.createElement('img');
        imgElement.src = discard.cards[discard.count-1].image;
        imgElement.alt = discard.cards[discard.count-1].name;

        // remove previous image and append new image
        discard_html.innerHTML = ""; 
        discard_html.appendChild(imgElement);

        //remove from images array
        hand.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
    
    else if (selectedCard.location==='prizes'){
        discard.cards.push(...prizes.cards.splice(selectedCard.index, 1));
    
        prizes_html.removeChild(prizes.images[selectedCard.index]);

        //Add to discard pile
        const imgElement = document.createElement('img');
        imgElement.src = discard.cards[discard.count-1].image;
        imgElement.alt = discard.cards[discard.count-1].name;

        // remove previous image and append new image
        discard_html.innerHTML = ""; 
        discard_html.appendChild(imgElement);

        //remove from images array
        prizes.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }

    else if (selectedCard.location==='active'){
        discard.cards.push(...active.cards.splice(selectedCard.index, 1));
    
        active_html.removeChild(active.images[selectedCard.index]);

        //Add to discard pile
        const imgElement = document.createElement('img');
        imgElement.src = discard.cards[discard.count-1].image;
        imgElement.alt = discard.cards[discard.count-1].name;

        // remove previous image and append new image
        discard_html.innerHTML = ""; 
        discard_html.appendChild(imgElement);

        //remove from images array
        active.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
    
    else if (selectedCard.location==='bench'){
        discard.cards.push(...bench.cards.splice(selectedCard.index, 1));
    
        bench_html.removeChild(bench.images[selectedCard.index]);

        //Add to discard pile
        const imgElement = document.createElement('img');
        imgElement.src = discard.cards[discard.count-1].image;
        imgElement.alt = discard.cards[discard.count-1].name;

        // remove previous image and appensd new image
        discard_html.innerHTML = ""; 
        discard_html.appendChild(imgElement);

        //remove from images array
        bench.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
        
    else if (selectedCard.location==='deck'){
        discard.cards.push(...deck.cards.splice(selectedCard.index, 1));
    
        deck_html.removeChild(deck.images[selectedCard.index]);

        //Add to discard pile
        const imgElement = document.createElement('img');
        imgElement.src = discard.cards[discard.count-1].image;
        imgElement.alt = discard.cards[discard.count-1].name;

        // remove previous image and append new image
        discard_html.innerHTML = ""; 
        discard_html.appendChild(imgElement);

        //remove from images array
        deck.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
        
    else if (selectedCard.location==='lostzone'){
        discard.cards.push(...lostzone.cards.splice(selectedCard.index, 1));
    
        lostzone_html.removeChild(lostzone.images[selectedCard.index]);

        //Add to discard pile
        const imgElement = document.createElement('img');
        imgElement.src = discard.cards[discard.count-1].image;
        imgElement.alt = discard.cards[discard.count-1].name;

        // remove previous image and append new image
        discard_html.innerHTML = ""; 
        discard_html.appendChild(imgElement);

        //remove from images array
        lostzone.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
        
    else if (selectedCard.location==='stadium'){
        discard.cards.push(...stadium.cards.splice(selectedCard.index, 1));
    
        stadium_html.removeChild(stadium.images[selectedCard.index]);

        //Add to discard pile
        const imgElement = document.createElement('img');
        imgElement.src = discard.cards[discard.count-1].image;
        imgElement.alt = discard.cards[discard.count-1].name;

        // remove previous image and append new image
        discard_html.innerHTML = ""; 
        discard_html.appendChild(imgElement);

        //remove from images array
        stadium.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }

    else {
        //remove popup
        popup.style.display = "none";
    };
}