import { activeArray, activeElement, attachedCardsArray, attachedCardsElement, benchArray, benchElement, boardArray, boardElement, deckArray, deckCoverElement, deckElement, discardArray, discardCoverElement, discardElement, handArray, handElement, lostZoneArray, lostZoneCoverElement, lostZoneElement, oppActiveArray, oppActiveElement, oppAttachedCardsArray, oppAttachedCardsElement, oppBenchArray, oppBenchElement, oppBoardArray, oppBoardElement, oppContainerDocument, oppDeckArray, oppDeckCoverElement, oppDeckElement, oppDiscardArray, oppDiscardCoverElement, oppDiscardElement, oppHandArray, oppHandElement, oppLostZoneArray, oppLostZoneCoverElement, oppLostZoneElement, oppPrizesArray, oppPrizesElement, oppViewCardsArray, oppViewCardsElement, systemState, prizesArray, prizesElement, selfContainerDocument, socket, stadiumArray, stadiumElement, viewCardsArray, viewCardsElement } from '../../front-end.js';
import { removeImages } from '../../image-logic/remove-images.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { buildDeck } from '../../setup/deck-constructor/build-deck.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { hideElementsIfEmpty } from './close-popups.js';
import { updateCount } from './count.js';

export const reset = (user, clean = false, emit = true, build = true, invalidMessage = true) => {
    systemState.turn = 0;
    let zoneArrays;
    let zoneElements;
    if (stadiumArray[0] && ((stadiumArray[0].image.user === 'self' && user === 'self') || (stadiumArray[0].image.user !== 'self' && user !== 'self'))){
        stadiumArray.length = 0;
        document.querySelectorAll('.tab').forEach(element => {
            element.classList.remove('tab');
        });
        removeImages(stadiumElement);
    };
    if (user === 'self'){
        zoneArrays = [deckArray, lostZoneArray, discardArray, prizesArray, activeArray, benchArray, handArray, attachedCardsArray, viewCardsArray, boardArray];
        zoneElements = [deckCoverElement, deckElement, lostZoneElement, discardElement, prizesElement, activeElement, benchElement, handElement, lostZoneCoverElement, discardCoverElement, attachedCardsElement, boardElement, viewCardsElement]

        selfContainerDocument.querySelectorAll('.self-circle, .opp-circle, .self-tab, .opp-tab').forEach(element => {
            element.textContent = '0'
            element.handleRemove();
        });
        selfContainerDocument.querySelectorAll('.used').forEach(element => {
            element.classList.remove('used');
        });
    } else {
        zoneArrays = [oppDeckArray, oppLostZoneArray, oppDiscardArray, oppPrizesArray, oppActiveArray, oppBenchArray, oppHandArray, oppAttachedCardsArray, oppViewCardsArray, oppBoardArray];
        zoneElements = [oppDeckElement, oppPrizesElement, oppDeckCoverElement, oppLostZoneElement, oppDiscardElement, oppActiveElement, oppBenchElement, oppHandElement, oppLostZoneCoverElement, oppDiscardCoverElement, oppAttachedCardsElement, oppViewCardsElement, oppBoardElement]

        oppContainerDocument.querySelectorAll('.self-circle, .opp-circle, .self-tab, .opp-tab').forEach(element => {
            element.textContent = '0'
            element.handleRemove();
        });
        oppContainerDocument.querySelectorAll('.used').forEach(element => {
            element.classList.remove('used');
        });
    };
    zoneArrays.forEach(array => array.length = 0);
    zoneElements.forEach(element => removeImages(element));

    hideElementsIfEmpty();

    if (build){
        if (determineDeckData(user)){
            buildDeck(user);
        } else if (invalidMessage){
            appendMessage(user, determineUsername(user) + ' has an invalid deck!', 'announcement', false);
        };
    };

    if (!clean && determineDeckData(user)){
        appendMessage(user, determineUsername(user) + ' reset', 'player', false);
    };    
    
    if (systemState.isTwoPlayer && emit){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : systemState.roomId,
            user : oUser,
            clean: clean,
            emit: false,
            build: build,
            invalidMessage: invalidMessage
        };
        socket.emit('reset', data);
    };
    updateCount();
}