import { hideCards, revealCards, revealShortcut } from '../../../actions/general/reveal-and-hide.js';
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../../../actions/zones/hand-actions.js';
import { mouseClick, systemState } from '../../../front-end.js';
import { appendMessage } from '../../../setup/chatbox/messages.js';
import { determineUsername } from '../../../setup/general/determine-username.js';
import { getZone } from '../../../setup/zones/get-zone.js';

export const initializeHandButtons = () => {
    const revealHideHandButton = document.getElementById('revealHideHandButton');
    revealHideHandButton.addEventListener('click', () => {
        const user = mouseClick.user;
        let rootDirectory = window.location.origin;

        if (mouseClick.card.image.src === rootDirectory + '/src/cardback.png') {
            revealCards(user, 'hand');
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + " revealed " + determineUsername(user) + "'s hand", 'player');
        } else {
            hideCards(user, 'hand');
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + " stopped looking at " + determineUsername(user) + "'s hand", 'player');
        };
    });

    const revealRandomHandButton = document.getElementById('revealRandomHandButton');
    revealRandomHandButton.addEventListener('click', () => {
        const user = mouseClick.user;
        const selectedHandCount = getZone(user, 'hand').getCount();
        const randomIndex = Math.floor(Math.random() * selectedHandCount);

        mouseClick.cardIndex = randomIndex;
        revealShortcut(user, mouseClick.zoneId, mouseClick.cardIndex);
    });

    const discardHandButton = document.getElementById('discardHandButton');
    discardHandButton.addEventListener('click', () => discardAndDraw(mouseClick.user));

    const shuffleHandButton = document.getElementById('shuffleHandButton');
    shuffleHandButton.addEventListener('click', () => shuffleAndDraw(mouseClick.user));

    const shuffleHandBottomButton = document.getElementById('shuffleHandBottomButton');
    shuffleHandBottomButton.addEventListener('click', () => shuffleBottomAndDraw(mouseClick.user));
};