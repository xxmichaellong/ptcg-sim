import { active, active_html, attachedCardPopup, attachedCardPopup_html, bench, bench_html, deck, deckDisplay_html, deck_html, discard, discardDisplay_html, discard_html, hand, hand_html, lostzone, lostzoneDisplay_html, lostzone_html, board, board_html, prizes, prizes_html, stadium, stadium_html, viewCards, viewCards_html } from "./self-initialization.js";
import { oppActive, oppActive_html, oppAttachedCardPopup, oppAttachedCardPopup_html, oppBench, oppBench_html, oppDeck, oppDeckDisplay_html, oppDeck_html, oppDiscard, oppDiscardDisplay_html, oppDiscard_html, oppHand, oppHand_html, oppLostzone, oppLostzoneDisplay_html, oppLostzone_html, oppBoard, oppBoard_html, oppPrizes, oppPrizes_html, oppViewCards, oppViewCards_html } from "./opp-initialization.js";

const selfLocations = {
    deck: deck,
    deck_html: deck_html,
    hand: hand,
    hand_html: hand_html,
    prizes: prizes,
    prizes_html: prizes_html,
    discard: discard,
    discard_html: discard_html,
    lostzone: lostzone,
    lostzone_html: lostzone_html,
    active: active,
    active_html: active_html,
    bench: bench,
    bench_html: bench_html,
    stadium: stadium,
    stadium_html: stadium_html,
    deckDisplay_html: deckDisplay_html,
    lostzoneDisplay_html: lostzoneDisplay_html,
    discardDisplay_html: discardDisplay_html,
    attachedCardPopup: attachedCardPopup,
    attachedCardPopup_html: attachedCardPopup_html,
    board: board,
    board_html: board_html,
    viewCards: viewCards,
    viewCards_html: viewCards_html
};

const oppLocations = {
    deck: oppDeck,
    deck_html: oppDeck_html,
    hand: oppHand,
    hand_html: oppHand_html,
    prizes: oppPrizes,
    prizes_html: oppPrizes_html,
    discard: oppDiscard,
    discard_html: oppDiscard_html,
    lostzone: oppLostzone,
    lostzone_html: oppLostzone_html,
    active: oppActive,
    active_html: oppActive_html,
    bench: oppBench,
    bench_html: oppBench_html,
    stadium: stadium,
    stadium_html: stadium_html,
    deckDisplay_html: oppDeckDisplay_html,
    lostzoneDisplay_html: oppLostzoneDisplay_html,
    discardDisplay_html: oppDiscardDisplay_html,
    attachedCardPopup: oppAttachedCardPopup,
    attachedCardPopup_html: oppAttachedCardPopup_html,
    board: oppBoard,
    board_html: oppBoard_html,
    viewCards: oppViewCards,
    viewCards_html: oppViewCards_html
};

export function stringToVariable(user, string) {
    const locations = user === 'self' ? selfLocations : oppLocations;
    return locations[string];
}

export function variableToString(user, variable) {
    const locations = user === 'self' ? selfLocations : oppLocations;
    return Object.keys(locations).find(key => locations[key] === variable);
}