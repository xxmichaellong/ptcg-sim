import { hand, bench, active, stadium, discard, prizes, lostzone, deck, attachedCardPopup, board, board_html, viewCards, viewCards_html } from '../../initialization/containers/self-containers.js';
import { oppActive, oppAttachedCardPopup, oppBench, oppDeck, oppDiscard, oppHand, oppLostzone, oppBoard, oppBoard_html, oppPrizes, oppViewCards, oppViewCards_html } from '../../initialization/containers/opp-containers.js';

export const containerIdToLocation = (user, containerId) => {
    let locations;
    if (user === 'self'){
        locations = {
            hand_html: hand,
            bench_html: bench,
            active_html: active,
            stadium_html: stadium,
            discard_html: discard,
            discardDisplay_html: discard,
            prizes_html: prizes,
            lostzone_html: lostzone,
            lostzoneDisplay_html: lostzone,
            deck_html: deck,
            deckDisplay_html: deck,
            lostzoneCover: lostzone,
            discardCover: discard,
            deckCover: deck,
            attachedCardPopup_html: attachedCardPopup,
            board_html: board,
            viewCards_html: viewCards
        };
    } else {
        locations = {
          hand_html: oppHand,
          bench_html: oppBench,
          active_html: oppActive,
          stadium_html: stadium,
          discard_html: oppDiscard,
          discardDisplay_html: oppDiscard,
          prizes_html: oppPrizes,
          lostzone_html: oppLostzone,
          lostzoneDisplay_html: oppLostzone,
          deck_html: oppDeck,
          deckDisplay_html: oppDeck,
          lostzoneCover: oppLostzone,
          discardCover: oppDiscard,
          deckCover: oppDeck,
          attachedCardPopup_html: oppAttachedCardPopup,
          board_html: oppBoard,
          viewCards_html: oppViewCards
      };
  };
  return locations[containerId];
}