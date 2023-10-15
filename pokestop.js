import { deck, deck_html, hand, hand_html, discard, discard_html } from "./initialization.js";
import { moveCard } from "./moveCard.js";
import { updateCount } from "./counts.js";

export function pokestop(){
    let i = 0;
    while (deck.count > 0 && i < 3){
        console.log(deck.cards[0].type);
        if (deck.cards[0].type === 'item')
            moveCard(deck, deck_html, hand, hand_html, 0);
        else
            moveCard(deck, deck_html, discard, discard_html, 0);
    i++;
    };
    updateCount();
    pokestopPopup.style.display = "none";
}