import {
  hideCards,
  lookAtCards,
  revealCards,
  stopLookingAtCards,
} from '../../../actions/general/reveal-and-hide.js';
import { shuffleZone } from '../../../actions/zones/shuffle-zone.js';
import { mouseClick, systemState } from '../../../front-end.js';

export const initializePrizesButtons = () => {
  const shufflePrizesButton = document.getElementById('shufflePrizesButton');
  shufflePrizesButton.addEventListener('click', () => {
    shuffleZone(mouseClick.cardUser, systemState.initiator, 'prizes');
  });

  const lookPrizesButton = document.getElementById('lookPrizesButton');
  lookPrizesButton.addEventListener('click', () => {
    if (
      [
        systemState.cardBackSrc,
        systemState.p1OppCardBackSrc,
        systemState.p2OppCardBackSrc,
      ].includes(mouseClick.card.image.src)
    ) {
      lookAtCards(mouseClick.cardUser, systemState.initiator, 'prizes');
    } else {
      stopLookingAtCards(mouseClick.cardUser, systemState.initiator, 'prizes');
    }
  });

  const revealHidePrizesButton = document.getElementById(
    'revealHidePrizesButton'
  );
  revealHidePrizesButton.addEventListener('click', () => {
    if (
      [
        systemState.cardBackSrc,
        systemState.p1OppCardBackSrc,
        systemState.p2OppCardBackSrc,
      ].includes(mouseClick.card.image.src)
    ) {
      revealCards(mouseClick.cardUser, systemState.initiator, 'prizes');
    } else {
      hideCards(mouseClick.cardUser, systemState.initiator, 'prizes');
    }
  });
};
