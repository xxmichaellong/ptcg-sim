import { deck, deck_html, hand, hand_html } from "../setup/initialization.js";
import { imageClick } from "../image-logic/image-click.js";

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
        imgElement.addEventListener('click', imageClick);
        hand_html.appendChild(imgElement);
        hand.images.push(imgElement);
        };
}