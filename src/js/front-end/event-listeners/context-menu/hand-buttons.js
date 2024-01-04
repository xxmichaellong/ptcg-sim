import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../../actions/zones/hand-actions.js';
import { hideCards, revealCards, revealShortcut } from '../../actions/general/reveal-and-hide.js';
import { systemState, discardHandButton, handArray, oppHandArray, revealHideHandButton, revealRandomHandButton, sCard, shuffleHandBottomButton, shuffleHandButton } from '../../front-end.js'
import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { getZoneCount } from '../../actions/general/count.js';

revealHideHandButton.addEventListener('click', () => {
    let rootDirectory = window.location.origin;

    if (sCard.card.image.src === rootDirectory + '/src/cardback.png'){
        revealCards(sCard.user, 'handArray', 'handElement');
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + " revealed " + determineUsername(sCard.user) + "'s hand", 'player');
    } else {
        hideCards(sCard.user, 'handArray', 'handElement');
        appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + " stopped looking at " + determineUsername(sCard.user) + "'s hand", 'player');
    };
});

revealRandomHandButton.addEventListener('click', () => {

    const selectedHandCount = sCard.user === 'self' ? getZoneCount(handArray) : getZoneCount(oppHandArray);
    const randomIndex = Math.floor(Math.random() * selectedHandCount);
    sCard.index = randomIndex;
    revealShortcut(sCard.user, sCard.zoneArrayString, sCard.index);
});

discardHandButton.addEventListener('click', () => discardAndDraw(sCard.user));

shuffleHandButton.addEventListener('click', () => shuffleAndDraw(sCard.user));
    
shuffleHandBottomButton.addEventListener('click', () => shuffleBottomAndDraw(sCard.user));
