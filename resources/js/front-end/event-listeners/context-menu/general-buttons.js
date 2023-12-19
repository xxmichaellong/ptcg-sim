import { moveToBoardButton, moveToBottomButton, moveToTopButton, shuffleIntoDeckButton, switchWithTopButton } from '../../front-end.js';
import { moveToBoard, moveToDeckBottom, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop } from '../../actions/container/deck-actions.js';

moveToTopButton.addEventListener('click', moveToDeckTop);

moveToBottomButton.addEventListener('click', moveToDeckBottom);

switchWithTopButton.addEventListener('click', switchWithDeckTop);

shuffleIntoDeckButton.addEventListener('click', shuffleIntoDeck);

moveToBoardButton.addEventListener('click', moveToBoard);