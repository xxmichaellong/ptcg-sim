import { hand_html, hand, discard, discard_html, prizes, prizes_html, lostzone, lostzone_html, 
        bench, bench_html, active, active_html, stadium, stadium_html, deck_html, deck, selectedCard } from "./initialization.js";

// Function to display the popup when the image is clicked
export function imageClick(event){

     //style the popup when image is clicked
     var popup = document.getElementById('popup');
     popup.style.display = 'block';

    //identify index of the card/image
    if (event.target.parentElement === hand_html){
        selectedCard.index = hand.images.indexOf(event.target);
        selectedCard.location = 'hand';
    }
    else if (event.target.parentElement === discard_html){
        selectedCard.index = discard.images.indexOf(event.target);
        selectedCard.location = 'discard';
    }
    else if (event.target.parentElement === prizes_html){
        selectedCard.index = prizes.images.indexOf(event.target);
        selectedCard.location = 'prizes';
    }
    else if (event.target.parentElement === lostzone_html){
        selectedCard.index = lostzone.images.indexOf(event.target);
        selectedCard.location = 'lostzone';
    }
    else if (event.target.parentElement === stadium_html){
        selectedCard.index = stadium.images.indexOf(event.target);
        selectedCard.location = 'stadium';
    }
    else if (event.target.parentElement === bench_html){
        selectedCard.index = bench.images.indexOf(event.target);
        selectedCard.location = 'bench';
    }
    else if (event.target.parentElement === active_html){
        selectedCard.index = active.images.indexOf(event.target);
        selectedCard.location = 'active';
    }
    else {
        selectedCard.index = deck.images.indexOf(event.target);
        selectedCard.location = 'deck';
    };
    console.log(selectedCard.index);
    console.log(event.target);

}