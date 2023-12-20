import { drawButton, sCard, shuffleDeckButton, viewBottomButton, viewTopButton } from '../../front-end.js'
import { draw, handleViewButtonClick, shuffleDeck} from '../../actions/container/deck-actions.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';

shuffleDeckButton.addEventListener('click', () => {
    shuffleDeck(sCard.user);
    appendMessage(sCard.user, determineUsername(sCard.user) + ' shuffled deck', 'player');
});

drawButton.addEventListener('click', () => draw(sCard.user));

viewTopButton.addEventListener('click', () => handleViewButtonClick(sCard.user, true));

viewBottomButton.addEventListener('click', () => handleViewButtonClick(sCard.user, false));






