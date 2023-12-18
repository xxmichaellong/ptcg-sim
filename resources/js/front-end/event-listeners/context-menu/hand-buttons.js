import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../../actions/container/hand-actions.js';
import { hideCards, revealCards } from '../../actions/general/reveal-and-hide.js';
import { discardHandButton, hideHandButton, revealHandButton, sCard, shuffleHandBottomButton, shuffleHandButton } from '../../front-end.js'

revealHandButton.addEventListener('click', () => revealCards(sCard.user, 'hand', 'hand_html'));

hideHandButton.addEventListener('click', () => hideCards(sCard.user, 'hand', 'hand_html'));

discardHandButton.addEventListener('click', () => discardAndDraw(sCard.user));

shuffleHandButton.addEventListener('click', () => shuffleAndDraw(sCard.user));
    
shuffleHandBottomButton.addEventListener('click', () => shuffleBottomAndDraw(sCard.user));
