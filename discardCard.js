import { index } from "./initialization.js";
import { discard } from "./initialization.js";
import { discard_html } from "./initialization.js";
import { hand } from "./initialization.js";
import { hand_html } from "./initialization.js";

export function discardCard(){
 
    //function to remove card from hand array and add it to discard array
    discard.cards.push(...hand.cards.splice(index.poo, 1));
   
    //function to remove image of card from hand container
    hand_html.removeChild(hand.images[index.poo]);


    //Add to discard pile
    const imgElement = document.createElement('img');
    imgElement.src = discard.cards[discard.count-1].image;
    imgElement.alt = discard.cards[discard.count-1].name;
    discard_html.innerHTML = ""; 
    discard_html.appendChild(imgElement);

    //remove popup
    popup.style.display = "none";
    console.log(index.poo);
    hand.images.splice(index.poo, 1);
}