import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../../actions/container/hand-actions.js';
import { hideCards, revealCards } from '../../actions/general/reveal-and-hide.js';
import { POV, discardHandButton, lookHandButton, sCard, shuffleHandBottomButton, shuffleHandButton } from '../../front-end.js'
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';

lookHandButton.addEventListener('click', () => {
    let rootDirectory = window.location.origin;

    if (sCard.card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        revealCards(sCard.user, 'hand', 'hand_html');
        appendMessage(POV.user, determineUsername(POV.user) + " looked at " + determineUsername(sCard.user) + "'s hand", 'player');
    } else {
        hideCards(sCard.user, 'hand', 'hand_html');
        appendMessage(POV.user, determineUsername(POV.user) + " stopped looking at " + determineUsername(sCard.user) + "'s hand", 'player');
    };
});

discardHandButton.addEventListener('click', () => discardAndDraw(sCard.user));

shuffleHandButton.addEventListener('click', () => shuffleAndDraw(sCard.user));
    
shuffleHandBottomButton.addEventListener('click', () => shuffleBottomAndDraw(sCard.user));
