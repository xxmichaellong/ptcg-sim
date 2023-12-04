import { deck, deck_html, deckDisplay_html, hand, hand_html, lostzone, lostzone_html, discard, discard_html, stadium, stadium_html, prizes, 
    prizes_html, active, active_html, bench, bench_html, lostzoneDisplay_html, discardDisplay_html, attachedCardPopup, attachedCardPopup_html, selfContainersDocument, viewCards, board, board_html, viewCards_html } from "../setup/self-initialization.js"
import { removeImages } from "../image-logic/remove-images.js";
import { oppActive, oppActive_html, oppBench, oppBench_html, oppDeck, oppDeck_html, oppDeckDisplay_html, oppDiscard, oppDiscard_html, oppHand,oppHand_html, oppLostzone, oppLostzone_html, oppPrizes, oppPrizes_html, oppLostzoneDisplay_html, oppDiscardDisplay_html, oppAttachedCardPopup, oppAttachedCardPopup_html, oppContainersDocument, oppViewCards, oppBoard, oppViewCards_html, oppBoard_html } from "./opp-initialization.js";

export function cleanUp(user){
    let cardArrays;
    let cardContainers;
    if (stadium.cards[0] && ((stadium.cards[0].image.user === 'self' && user === 'self') || (stadium.cards[0].image.user !== 'self' && user !== 'self'))){
        stadium.cards = [];
        removeImages(stadium_html);
    };
    if (user === 'self'){
        cardArrays = [deck, lostzone, discard, prizes, active, bench, hand, attachedCardPopup, viewCards, board];
        cardContainers = [deckDisplay_html, deck_html, lostzone_html, discard_html, prizes_html, active_html, bench_html, hand_html, lostzoneDisplay_html, discardDisplay_html, attachedCardPopup_html, board_html, viewCards_html]

        selfContainersDocument.querySelectorAll('.circle').forEach(element => {
            element.textContent = '0'
            element.handleRemove();
        });
    } else {
        cardArrays = [oppDeck, oppLostzone, oppDiscard, oppPrizes, oppActive, oppBench, oppHand, oppAttachedCardPopup, oppViewCards, oppBoard];
        cardContainers = [oppDeck_html, oppPrizes_html, oppDeckDisplay_html, oppLostzone_html, oppDiscard_html, oppActive_html, oppBench_html, oppHand_html, oppLostzoneDisplay_html, oppDiscardDisplay_html, oppAttachedCardPopup_html, oppViewCards_html, oppBoard_html]

        oppContainersDocument.querySelectorAll('.circle').forEach(element => {
            element.textContent = '0'
            element.handleRemove();
        });
    };
    cardArrays.forEach(container => container.cards = []);
    cardContainers.forEach(container => removeImages(container));
}