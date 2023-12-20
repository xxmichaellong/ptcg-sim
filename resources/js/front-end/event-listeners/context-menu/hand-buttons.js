import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../../actions/container/hand-actions.js';
import { hideCards, revealCards } from '../../actions/general/reveal-and-hide.js';
import { POV, discardHandButton, hideHandButton, revealHandButton, sCard, shuffleHandBottomButton, shuffleHandButton } from '../../front-end.js'
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';

revealHandButton.addEventListener('click', () => {
    revealCards(sCard.user, 'hand', 'hand_html');
    appendMessage(POV.user, determineUsername(POV.user) + " looked at opponent's hand", 'player');
});

hideHandButton.addEventListener('click', () => {
    hideCards(sCard.user, 'hand', 'hand_html');
    appendMessage(POV.user, determineUsername(POV.user) + " hid opponent's hand", 'player');
});

discardHandButton.addEventListener('click', () => discardAndDraw(sCard.user));

shuffleHandButton.addEventListener('click', () => shuffleAndDraw(sCard.user));
    
shuffleHandBottomButton.addEventListener('click', () => shuffleBottomAndDraw(sCard.user));
