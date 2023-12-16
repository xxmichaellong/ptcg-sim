import { moveToBoardButton, moveToBottomButton, moveToTopButton, sCard, shuffleIntoDeckButton, socket } from '../../front-end.js';
import { moveToBoard, moveToDeckBottom, moveToDeckTop, shuffleIntoDeck } from '../../actions/container/deck-actions.js';

moveToTopButton.addEventListener('click', moveToDeckTop);

moveToBottomButton.addEventListener('click', moveToDeckBottom);

shuffleIntoDeckButton.addEventListener('click', shuffleIntoDeck);

moveToBoardButton.addEventListener('click', moveToBoard);