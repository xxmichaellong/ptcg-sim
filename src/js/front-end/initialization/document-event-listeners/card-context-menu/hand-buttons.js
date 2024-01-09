import { stopLookingAtCards, playRandomCardFaceDown, lookAtCards } from '../../../actions/general/reveal-and-hide.js';
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../../../actions/zones/hand-actions.js';
import { mouseClick, systemState } from '../../../front-end.js';

export const initializeHandButtons = () => {
    const lookHandButton = document.getElementById('lookHandButton');
    lookHandButton.addEventListener('click', () => {
        let rootDirectory = window.location.origin;
        if (mouseClick.card.image.src === rootDirectory + '/src/cardback.png') {
            lookAtCards(systemState.initiator, mouseClick.cardUser, 'hand');
        } else {
            stopLookingAtCards(systemState.initiator, mouseClick.cardUser, 'hand');
        };
    });

    const randomHandButton = document.getElementById('randomHandButton');
    randomHandButton.addEventListener('click', () => playRandomCardFaceDown(systemState.initiator, mouseClick.cardUser));

    const discardHandButton = document.getElementById('discardHandButton');
    discardHandButton.addEventListener('click', () => discardAndDraw(systemState.initiator, mouseClick.cardUser));

    const shuffleHandButton = document.getElementById('shuffleHandButton');
    shuffleHandButton.addEventListener('click', () => shuffleAndDraw(systemState.initiator, mouseClick.cardUser));

    const shuffleHandBottomButton = document.getElementById('shuffleHandBottomButton');
    shuffleHandBottomButton.addEventListener('click', () => shuffleBottomAndDraw(systemState.initiator, mouseClick.cardUser));
};