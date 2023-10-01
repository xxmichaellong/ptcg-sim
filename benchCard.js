import { hand_html, hand, discard, discard_html, prizes, prizes_html, lostzone, lostzone_html, 
    bench, bench_html, active, active_html, stadium, stadium_html, deck_html, deck, selectedCard } from "./initialization.js";
import { imageClick } from "./imageClick.js";


export function benchCard(){
    
    if (selectedCard.location==='hand'){

        //function to remove card from hand array and add it to bench array
        bench.cards.push(...hand.cards.splice(selectedCard.index, 1));
    
        //function to remove image of card from hand container
        hand_html.removeChild(...hand.images.splice(selectedCard.index, 1));

        //Add to bench pile
        const imgElement = document.createElement('img');
        imgElement.src = bench.cards[bench.count-1].image;
        imgElement.alt = bench.cards[bench.count-1].name;
        imgElement.addEventListener('click', imageClick);

        // append new image
        bench_html.appendChild(imgElement);

        //Add the image to an array so we can access it later
        bench.images.push(imgElement);    

        //remove popup
        popup.style.display = "none";
    }
    
    else if (selectedCard.location==='prizes'){
        bench.cards.push(...prizes.cards.splice(selectedCard.index, 1));
    
        prizes_html.removeChild(prizes.images[selectedCard.index]);

        //Add to bench pile
        const imgElement = document.createElement('img');
        imgElement.src = bench.cards[bench.count-1].image;
        imgElement.alt = bench.cards[bench.count-1].name;
        imgElement.addEventListener('click', imageClick);

        // remove previous image and append new image
        bench_html.innerHTML = ""; 
        bench_html.appendChild(imgElement);

        //remove from images array
        prizes.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }

    else if (selectedCard.location==='active'){
        bench.cards.push(...active.cards.splice(selectedCard.index, 1));
    
        active_html.removeChild(active.images[selectedCard.index]);

        //Add to bench pile
        const imgElement = document.createElement('img');
        imgElement.src = bench.cards[bench.count-1].image;
        imgElement.alt = bench.cards[bench.count-1].name;
        imgElement.addEventListener('click', imageClick);

        // remove previous image and append new image
        bench_html.innerHTML = ""; 
        bench_html.appendChild(imgElement);

        //remove from images array
        active.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
    
    else if (selectedCard.location==='discard'){
        bench.cards.push(...discard.cards.splice(selectedCard.index, 1));
    
        discard_html.removeChild(discard.images[selectedCard.index]);

        //Add to bench pile
        const imgElement = document.createElement('img');
        imgElement.src = bench.cards[bench.count-1].image;
        imgElement.alt = bench.cards[bench.count-1].name;
        imgElement.addEventListener('click', imageClick);

        // remove previous image and append new image
        bench_html.innerHTML = ""; 
        bench_html.appendChild(imgElement);

        //remove from images array
        discard.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
        
    else if (selectedCard.location==='deck'){
        bench.cards.push(...deck.cards.splice(selectedCard.index, 1));
    
        deck_html.removeChild(deck.images[selectedCard.index]);

        //Add to bench pile
        const imgElement = document.createElement('img');
        imgElement.src = bench.cards[bench.count-1].image;
        imgElement.alt = bench.cards[bench.count-1].name;
        imgElement.addEventListener('click', imageClick);

        // remove previous image and append new image
        bench_html.innerHTML = ""; 
        bench_html.appendChild(imgElement);

        //remove from images array
        deck.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
        
    else if (selectedCard.location==='lostzone'){
        bench.cards.push(...lostzone.cards.splice(selectedCard.index, 1));
    
        lostzone_html.removeChild(lostzone.images[selectedCard.index]);

        //Add to bench pile
        const imgElement = document.createElement('img');
        imgElement.src = bench.cards[bench.count-1].image;
        imgElement.alt = bench.cards[bench.count-1].name;
        imgElement.addEventListener('click', imageClick);

        // remove previous image and append new image
        bench_html.innerHTML = ""; 
        bench_html.appendChild(imgElement);

        //remove from images array
        lostzone.images.splice(selectedCard.index, 1);

        //remove popup
        popup.style.display = "none";
    }
        
    else if (selectedCard.location==='stadium'){
        bench.cards.push(...stadium.cards.splice(selectedCard.index, 1));
    
        stadium_html.removeChild(stadium.images[selectedCard.index]);

        //Add to bench pile
        const imgElement = document.createElement('img');
        imgElement.src = bench.cards[bench.count-1].image;
        imgElement.alt = bench.cards[bench.count-1].name;
        imgElement.addEventListener('click', imageClick);

        // remove previous image and append new image
        bench_html.innerHTML = ""; 
        bench_html.appendChild(imgElement);

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