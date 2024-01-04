import { oppActiveArray, oppActiveElement, oppAttachedCardsArray, oppAttachedCardsElement, oppBenchArray, oppBenchElement, oppDeckArray, oppDeckCoverElement, oppDeckElement, oppDiscardArray, oppDiscardCoverElement, oppDiscardElement, oppHandArray, oppHandElement, oppLostZoneArray, oppLostZoneCoverElement, oppLostZoneElement, oppBoardArray, oppBoardElement, oppPrizesArray, oppPrizesElement, oppViewCardsArray, oppViewCardsElement, activeArray, activeElement, attachedCardsArray, attachedCardsElement, benchArray, benchElement, deckArray, deckCoverElement, deckElement, discardArray, discardCoverElement, discardElement, handArray, handElement, lostZoneArray, lostZoneCoverElement, lostZoneElement, boardArray, boardElement, prizesArray, prizesElement, stadiumArray, stadiumElement, viewCardsArray, viewCardsElement } from '../../front-end.js';

const selfZoneDictionary = {
    deckArray: deckArray,
    deckElement: deckElement,
    handArray: handArray,
    handElement: handElement,
    prizesArray: prizesArray,
    prizesElement: prizesElement,
    discardArray: discardArray,
    discardElement: discardElement,
    lostZoneArray: lostZoneArray,
    lostZoneElement: lostZoneElement,
    activeArray: activeArray,
    activeElement: activeElement,
    benchArray: benchArray,
    benchElement: benchElement,
    stadiumArray: stadiumArray,
    stadiumElement: stadiumElement,
    deckCoverElement: deckCoverElement,
    lostZoneCoverElement: lostZoneCoverElement,
    discardCoverElement: discardCoverElement,
    attachedCardsArray: attachedCardsArray,
    attachedCardsElement: attachedCardsElement,
    boardArray: boardArray,
    boardElement: boardElement,
    viewCardsArray: viewCardsArray,
    viewCardsElement: viewCardsElement
};

const oppZoneDictionary = {
    deckArray: oppDeckArray,
    deckElement: oppDeckElement,
    handArray: oppHandArray,
    handElement: oppHandElement,
    prizesArray: oppPrizesArray,
    prizesElement: oppPrizesElement,
    discardArray: oppDiscardArray,
    discardElement: oppDiscardElement,
    lostZoneArray: oppLostZoneArray,
    lostZoneElement: oppLostZoneElement,
    activeArray: oppActiveArray,
    activeElement: oppActiveElement,
    benchArray: oppBenchArray,
    benchElement: oppBenchElement,
    stadiumArray: stadiumArray,
    stadiumElement: stadiumElement,
    deckCoverElement: oppDeckCoverElement,
    lostZoneCoverElement: oppLostZoneCoverElement,
    discardCoverElement: oppDiscardCoverElement,
    attachedCardsArray: oppAttachedCardsArray,
    attachedCardsElement: oppAttachedCardsElement,
    boardArray: oppBoardArray,
    boardElement: oppBoardElement,
    viewCardsArray: oppViewCardsArray,
    viewCardsElement: oppViewCardsElement
};

export const stringToVariable = (user, string) => {
    const zoneDictionary = user === 'self' ? selfZoneDictionary : oppZoneDictionary;
    return zoneDictionary[string];
}

export const variableToString = (user, variable) => {
    const zoneDictionary = user === 'self' ? selfZoneDictionary : oppZoneDictionary;
    return Object.keys(zoneDictionary).find(key => zoneDictionary[key] === variable);
}