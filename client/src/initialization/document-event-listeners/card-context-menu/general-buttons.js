import {
  hideShortcut,
  revealShortcut,
} from '../../../actions/general/reveal-and-hide.js';
import {
  moveToBoard,
  moveToDeckBottom,
  moveToDeckTop,
  shuffleIntoDeck,
  switchWithDeckTop,
} from '../../../actions/zones/deck-actions.js';
import {
  mouseClick,
  systemState,
} from '../../global-variables/global-variables.js';

export const initializeGeneralButtons = () => {
  const moveToTopButton = document.getElementById('moveToTopButton');
  moveToTopButton.addEventListener('click', () =>
    moveToDeckTop(
      mouseClick.cardUser,
      systemState.initiator,
      mouseClick.zoneId,
      mouseClick.cardIndex
    )
  );

  const moveToBottomButton = document.getElementById('moveToBottomButton');
  moveToBottomButton.addEventListener('click', () =>
    moveToDeckBottom(
      mouseClick.cardUser,
      systemState.initiator,
      mouseClick.zoneId,
      mouseClick.cardIndex
    )
  );

  const switchWithTopButton = document.getElementById('switchWithTopButton');
  switchWithTopButton.addEventListener('click', () =>
    switchWithDeckTop(
      mouseClick.cardUser,
      systemState.initiator,
      mouseClick.zoneId,
      mouseClick.cardIndex
    )
  );

  const shuffleIntoDeckButton = document.getElementById(
    'shuffleIntoDeckButton'
  );
  shuffleIntoDeckButton.addEventListener('click', () =>
    shuffleIntoDeck(
      mouseClick.cardUser,
      systemState.initiator,
      mouseClick.zoneId,
      mouseClick.cardIndex
    )
  );

  const moveToBoardButton = document.getElementById('moveToBoardButton');
  moveToBoardButton.addEventListener('click', () =>
    moveToBoard(
      mouseClick.cardUser,
      systemState.initiator,
      mouseClick.zoneId,
      mouseClick.cardIndex
    )
  );

  const revealHideButton = document.getElementById('revealHideButton');
  revealHideButton.addEventListener('click', () => {
    if (
      [
        systemState.cardBackSrc,
        systemState.p1OppCardBackSrc,
        systemState.p2OppCardBackSrc,
      ].includes(mouseClick.card.image.src)
    ) {
      revealShortcut(
        mouseClick.cardUser,
        systemState.initiator,
        mouseClick.zoneId,
        mouseClick.cardIndex
      );
    } else {
      hideShortcut(
        mouseClick.cardUser,
        systemState.initiator,
        mouseClick.zoneId,
        mouseClick.cardIndex
      );
    }
  });
};
