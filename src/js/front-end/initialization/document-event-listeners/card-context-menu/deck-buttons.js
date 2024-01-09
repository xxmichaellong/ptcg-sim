import { draw, handleViewButtonClick } from '../../../actions/zones/deck-actions.js';
import { shuffleZone } from '../../../actions/zones/shuffle-zone.js';
import { mouseClick, systemState } from '../../../front-end.js';

export const initializeDeckButtons = () => {
    const shuffleDeckButton = document.getElementById('shuffleDeckButton');
    shuffleDeckButton.addEventListener('click', () => {
        shuffleZone(systemState.initiator, mouseClick.cardUser, 'deck');
    });

    const drawButton = document.getElementById('drawButton');
    drawButton.addEventListener('click', () => draw(systemState.initiator, mouseClick.cardUser));

    const viewTopButton = document.getElementById('viewTopButton');
    viewTopButton.addEventListener('click', () => handleViewButtonClick(mouseClick.cardUser, true));

    const viewBottomButton = document.getElementById('viewBottomButton');
    viewBottomButton.addEventListener('click', () => handleViewButtonClick(mouseClick.cardUser, false));
};