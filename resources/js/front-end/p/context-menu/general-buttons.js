import { moveToBoard, moveToBottomButton, moveToTopButton, sCard, shuffleToDeckButton, socket } from '../../front-end.js';
import { moveToDeckTop, shuffleIntoDeck } from '../../actions/container/deck-actions.js';

moveToTopButton.addEventListener('click', moveToDeckTop);

moveToBottomButton.addEventListener('click', () => {
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);
    socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);
});

shuffleToDeckButton.addEventListener('click', shuffleIntoDeck);

moveToBoard.addEventListener('click', () => {
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'board', 'board_html', sCard.index);
    socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'board', 'board_html', sCard.index);
});