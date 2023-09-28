import { deck } from "./initialization.js";
import { deck_html } from "./initialization.js";
import { hand } from "./initialization.js";
import { hand_html } from "./initialization.js";

//Function to draw a card from deck
export function drawCard(){
    //Check if there is a card in deck
    if (deck.count===0){
        const errormsg = 'No more cards in deck';
        console.error(errormsg);
        deck_html.textContent = errormsg;
    }
    else {
        hand.cards.push(...deck.cards.splice(0, 1));

        const imgElement = document.createElement('img');
        imgElement.src = hand.cards[hand.count-1].image;
        imgElement.alt = hand.cards[hand.count-1].name;

         //Add a data attribute to store the index
         imgElement.dataset.arrayIndex = hand.count-1;

         //Add a click event listener to the image
         // imgElement.addEventListener('click', handleImageClick);

        hand_html.appendChild(imgElement);
        
        console.log(deck.cards);
        console.log(deck.count);
        };
}