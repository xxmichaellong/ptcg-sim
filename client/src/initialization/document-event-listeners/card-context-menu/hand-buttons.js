import {
  stopLookingAtCards,
  playRandomCardFaceDown,
  lookAtCards,
} from '../../../actions/general/reveal-and-hide.js';
import {
  discardAndDraw,
  shuffleAndDraw,
  shuffleBottomAndDraw,
} from '../../../actions/zones/hand-actions.js';
import { mouseClick, systemState } from '../../../front-end.js';

export const initializeHandButtons = () => {
  const lookHandButton = document.getElementById('lookHandButton');
  lookHandButton.addEventListener('click', () => {
    if (
      [
        systemState.cardBackSrc,
        systemState.p1OppCardBackSrc,
        systemState.p2OppCardBackSrc,
      ].includes(mouseClick.card.image.src)
    ) {
      lookAtCards(mouseClick.cardUser, systemState.initiator, 'hand');
    } else {
      stopLookingAtCards(mouseClick.cardUser, systemState.initiator, 'hand');
    }
  });

  const randomHandButton = document.getElementById('randomHandButton');
  randomHandButton.addEventListener('click', () =>
    playRandomCardFaceDown(mouseClick.cardUser, systemState.initiator)
  );

  const discardHandButton = document.getElementById('discardHandButton');
  discardHandButton.addEventListener('click', () =>
    discardAndDraw(mouseClick.cardUser, systemState.initiator)
  );

  const shuffleHandButton = document.getElementById('shuffleHandButton');
  shuffleHandButton.addEventListener('click', () =>
    shuffleAndDraw(mouseClick.cardUser, systemState.initiator)
  );

  const shuffleHandBottomButton = document.getElementById(
    'shuffleHandBottomButton'
  );
  shuffleHandBottomButton.addEventListener('click', () =>
    shuffleBottomAndDraw(mouseClick.cardUser, systemState.initiator)
  );
};
