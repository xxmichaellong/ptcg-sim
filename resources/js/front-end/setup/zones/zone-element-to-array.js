import { oppActiveArray, oppAttachedCardsArray, oppBenchArray, oppDeckArray, oppDiscardArray, oppHandArray, oppLostZoneArray, oppBoardArray, oppPrizesArray, oppViewCardsArray, handArray, benchArray, activeArray, stadiumArray, discardArray, prizesArray, lostZoneArray, deckArray, attachedCardsArray, boardArray, viewCardsArray } from '../../front-end.js';

export const zoneElementToArray = (user, zoneElementString) => {
    let zoneDictionary;
    if (user === 'self'){
        zoneDictionary = {
            handElement: handArray,
            benchElement: benchArray,
            activeElement: activeArray,
            stadiumElement: stadiumArray,
            discardElement: discardArray,
            discardCoverElement: discardArray,
            prizesElement: prizesArray,
            lostZoneElement: lostZoneArray,
            lostZoneCoverElement: lostZoneArray,
            deckElement: deckArray,
            deckCoverElement: deckArray,
            lostZoneCover: lostZoneArray,
            discardCover: discardArray,
            deckCover: deckArray,
            attachedCardsElement: attachedCardsArray,
            boardElement: boardArray,
            viewCardsElement: viewCardsArray
        };
    } else {
        zoneDictionary = {
          handElement: oppHandArray,
          benchElement: oppBenchArray,
          activeElement: oppActiveArray,
          stadiumElement: stadiumArray,
          discardElement: oppDiscardArray,
          discardCoverElement: oppDiscardArray,
          prizesElement: oppPrizesArray,
          lostZoneElement: oppLostZoneArray,
          lostZoneCoverElement: oppLostZoneArray,
          deckElement: oppDeckArray,
          deckCoverElement: oppDeckArray,
          lostZoneCover: oppLostZoneArray,
          discardCover: oppDiscardArray,
          deckCover: oppDeckArray,
          attachedCardsElement: oppAttachedCardsArray,
          boardElement: oppBoardArray,
          viewCardsElement: oppViewCardsArray
      };
  };
  return zoneDictionary[zoneElementString];
}