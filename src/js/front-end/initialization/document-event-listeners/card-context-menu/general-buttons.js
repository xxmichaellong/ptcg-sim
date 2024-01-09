import { hideShortcut, revealShortcut } from '../../../actions/general/reveal-and-hide.js';
import { moveToBoard, moveToDeckBottom, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop } from '../../../actions/zones/deck-actions.js';
import { mouseClick, systemState } from '../../global-variables/global-variables.js';

export const initializeGeneralButtons = () => {
    const moveToTopButton = document.getElementById('moveToTopButton');
    moveToTopButton.addEventListener('click', () => moveToDeckTop(systemState.initiator, mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex));

    const moveToBottomButton = document.getElementById('moveToBottomButton');
    moveToBottomButton.addEventListener('click', () => moveToDeckBottom(systemState.initiator, mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex));

    const switchWithTopButton = document.getElementById('switchWithTopButton');
    switchWithTopButton.addEventListener('click', () => switchWithDeckTop(systemState.initiator, mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex));

    const shuffleIntoDeckButton = document.getElementById('shuffleIntoDeckButton');
    shuffleIntoDeckButton.addEventListener('click', () => shuffleIntoDeck(systemState.initiator, mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex));

    const moveToBoardButton = document.getElementById('moveToBoardButton');
    moveToBoardButton.addEventListener('click', () => moveToBoard(systemState.initiator, mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex));

    const revealHideButton = document.getElementById('revealHideButton');
    revealHideButton.addEventListener('click', () => {
        let rootDirectory = window.location.origin;
        if (mouseClick.card.image.src !== rootDirectory + '/src/cardback.png'){
            hideShortcut(systemState.initiator, mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex);
        } else {
            revealShortcut(systemState.initiator, mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex);
        };
    });
};