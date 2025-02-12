import {
  draw,
  handleViewButtonClick,
} from '../../../actions/zones/deck-actions.js';
import { shuffleAll } from '../../../actions/zones/general.js';
import { mouseClick, systemState } from '../../../front-end.js';

export const initializeDeckButtons = () => {
  const shuffleDeckButton = document.getElementById('shuffleDeckButton');
  shuffleDeckButton.addEventListener('click', () => {
    shuffleAll(mouseClick.cardUser, systemState.initiator, 'deck');
  });

  const drawButton = document.getElementById('drawButton');
  drawButton.addEventListener('click', () =>
    draw(mouseClick.cardUser, systemState.initiator)
  );

  const viewTopButton = document.getElementById('viewTopButton');
  viewTopButton.addEventListener('click', () =>
    handleViewButtonClick(mouseClick.cardUser, systemState.initiator, true)
  );

  const viewBottomButton = document.getElementById('viewBottomButton');
  viewBottomButton.addEventListener('click', () =>
    handleViewButtonClick(mouseClick.cardUser, systemState.initiator, false)
  );
};
