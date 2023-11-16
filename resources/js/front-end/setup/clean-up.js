import { deck, deck_html, deckDisplay_html, hand, hand_html, lostzone, lostzone_html, discard, discard_html, stadium, stadium_html, prizes, 
    prizes_html, active, active_html, bench, bench_html, lostzoneDisplay_html, discardDisplay_html, attachedCardPopup, attachedCardPopup_html } from "../setup/initialization.js"
import { removeImages } from "../image-logic/remove-images.js";
import { oppActive, oppActive_html, oppBench, oppBench_html, oppDeck, oppDeck_html, oppDeckDisplay_html, oppDiscard, oppDiscard_html, oppHand,oppHand_html, oppLostzone, oppLostzone_html, oppPrizes, oppPrizes_html, oppLostzoneDisplay_html, oppDiscardDisplay_html, oppAttachedCardPopup, oppAttachedCardPopup_html } from "./opp-initialization.js";
import { socket } from "../front-end.js";

export function cleanUp(user){
    let cardArrays;
    let cardContainers;
    if (stadium.cards[0] && stadium.cards[0].image.user === 'self' && user === 'self'){
       removeStadium();
       socket.emit('removeStadium');
    };
    if (user === 'self'){
        cardArrays = [deck, lostzone, discard, prizes, active, bench, hand, attachedCardPopup];
        cardContainers = [deckDisplay_html, deck_html, lostzone_html, discard_html, prizes_html, active_html, bench_html, hand_html, lostzoneDisplay_html, discardDisplay_html, attachedCardPopup_html]
    } else {
        cardArrays = [oppDeck, oppLostzone, oppDiscard, oppPrizes, oppActive, oppBench, oppHand, oppAttachedCardPopup];
        cardContainers = [oppDeck_html, oppPrizes_html, oppDeckDisplay_html, oppLostzone_html, oppDiscard_html, oppActive_html, oppBench_html, oppHand_html, oppLostzoneDisplay_html, oppDiscardDisplay_html, oppAttachedCardPopup_html]
    };
    cardArrays.forEach(container => container.cards = []);
    cardContainers.forEach(container => removeImages(container));
}

export function removeStadium(){
    stadium.cards = [];
    removeImages(stadium_html);
}