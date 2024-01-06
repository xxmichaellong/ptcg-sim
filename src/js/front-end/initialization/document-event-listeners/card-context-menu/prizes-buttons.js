import { hideCards, hideShortcut, revealCards, revealShortcut } from "../../../actions/general/reveal-and-hide.js";
import { shuffleZone } from "../../../actions/zones/shuffle-zone.js";
import { mouseClick } from "../../../front-end.js";
import { appendMessage } from "../../../setup/chatbox/messages.js";
import { determineUsername } from "../../../setup/general/determine-username.js";
import { getZone } from "../../../setup/zones/get-zone.js";

export const initializePrizesButtons = () => {
    const rootDirectory = window.location.origin;

    const shufflePrizesButton = document.getElementById('shufflePrizesButton');
    shufflePrizesButton.addEventListener('click', () => {
        const user = mouseClick.user;
        shuffleZone(user, 'prizes');
        appendMessage(user, determineUsername(user) + ' shuffled prizes', 'player');
    });

    const lookPrizesButton = document.getElementById('lookPrizesButton');
    lookPrizesButton.addEventListener('click', () => {
        const user = mouseClick.user;
        if (mouseClick.card.image.src === rootDirectory + '/src/cardback.png') {
            revealCards(user, 'prizes');
            appendMessage(user, determineUsername(user) + ' looked at prizes', 'player');
        } else {
            hideCards(user, 'prizes');
            appendMessage(user, determineUsername(user) + ' stopped looking at prizes', 'player');
        }
    });

    const revealHidePrizesButton = document.getElementById('revealHidePrizesButton');
    revealHidePrizesButton.addEventListener('click', () => {
        const user = mouseClick.user;
        const prizesCount = getZone(user, 'prizes').getCount();

        if (mouseClick.card.image.src === rootDirectory + '/src/cardback.png') {
            for (let i = 0; i < prizesCount; i++) {
                revealShortcut(user, mouseClick.zoneId, i, false);
            }
            appendMessage(user, determineUsername(user) + ' revealed prizes', 'player');
        } else {
            for (let i = 0; i < prizesCount; i++) {
                hideShortcut(user, mouseClick.zoneId, i, false);
            }
            appendMessage(user, determineUsername(user) + ' hid prizes', 'player');
        };
    });
};