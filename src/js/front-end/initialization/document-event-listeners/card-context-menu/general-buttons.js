import { hideShortcut, revealShortcut } from '../../../actions/general/reveal-and-hide.js';
import { moveToBoard, moveToDeckBottom, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop } from '../../../actions/zones/deck-actions.js';
import { mouseClick } from '../../global-variables/global-variables.js';

export const initializeGeneralButtons = () => {
    const moveToTopButton = document.getElementById('moveToTopButton');
    moveToTopButton.addEventListener('click', moveToDeckTop);

    const moveToBottomButton = document.getElementById('moveToBottomButton');
    moveToBottomButton.addEventListener('click', moveToDeckBottom);

    const switchWithTopButton = document.getElementById('switchWithTopButton');
    switchWithTopButton.addEventListener('click', switchWithDeckTop);

    const shuffleIntoDeckButton = document.getElementById('shuffleIntoDeckButton');
    shuffleIntoDeckButton.addEventListener('click', shuffleIntoDeck);

    const moveToBoardButton = document.getElementById('moveToBoardButton');
    moveToBoardButton.addEventListener('click', moveToBoard);

    const revealHideButton = document.getElementById('revealHideButton');
    revealHideButton.addEventListener('click', () => {
        let rootDirectory = window.location.origin;
        if (mouseClick.card.image.src !== rootDirectory + '/src/cardback.png'){
            hideShortcut(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
        } else {
            revealShortcut(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
        };
    });
};