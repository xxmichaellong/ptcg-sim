import {
  discardBoard,
  handBoard,
  lostZoneBoard,
  shuffleBoard,
} from '../../../actions/general/board-actions.js';
import { mouseClick, systemState } from '../../../front-end.js';

export const initializeBoardButtons = () => {
  const discardBoardButton = document.getElementById('discardBoardButton');
  discardBoardButton.addEventListener('click', () =>
    discardBoard(mouseClick.cardUser, systemState.initiator)
  );

  const shuffleBoardButton = document.getElementById('shuffleBoardButton');
  shuffleBoardButton.addEventListener('click', () =>
    shuffleBoard(mouseClick.cardUser, systemState.initiator)
  );

  const lostZoneBoardButton = document.getElementById('lostZoneBoardButton');
  lostZoneBoardButton.addEventListener('click', () =>
    lostZoneBoard(mouseClick.cardUser, systemState.initiator)
  );

  const handBoardButton = document.getElementById('handBoardButton');
  handBoardButton.addEventListener('click', () =>
    handBoard(mouseClick.cardUser, systemState.initiator)
  );
};
