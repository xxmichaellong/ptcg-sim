import { rearrangeArray } from "../setup/shuffle.js"
import { removeImages } from "../image-logic/remove-images.js";
import { deck, deck_html, prizes, prizes_html } from "../setup/initialization.js";
import { oppDeck, oppDeck_html, oppPrizes, oppPrizes_html } from "../setup/opp-initialization.js";
import { socket } from "../front-end.js";
import { stringToVariable } from "../setup/string-to-variable.js";
import { shuffleIndices } from "../setup/shuffle.js";

export function triggerShufflePopup(){
    const popup = document.getElementById('shufflePopup');
    popup.style.display = 'block';
}

export function shuffleContainer(user, locationAsString, indices){
    let container;
    let container_html;
    if (user === 'self'){
        if (locationAsString === 'deck'){
            container = deck;
            container_html = deck_html;
        } else {
            container = prizes;
            container_html = prizes_html;
        }
    } else {
        if (locationAsString === 'deck'){
            container = oppDeck;
            container_html = oppDeck_html
        } else {
            container = oppPrizes;
            container_html = oppPrizes_html
        }
    }
    removeImages(container_html);

    container.cards = rearrangeArray(container.cards, indices);

    for (let i = 0; i < container.count; i++){
        container_html.appendChild(container.cards[i].image);
    };
    
    shufflePopup.style.display = "none";
}

export function shuffleButtonFunction (user, locationAsString, indices){
    //shuffle the indices only if it's the own user
    const location = stringToVariable(user, locationAsString);
    if (user === 'self'){
        indices = shuffleIndices(location.cards.length);
    };
    shuffleContainer(user, locationAsString, indices);
    
    if (user === 'self')
        socket.emit('shuffleButtonFunction', 'opp', locationAsString, indices);
}