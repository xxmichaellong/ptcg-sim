import { shuffleContainer } from "../../actions/container/shuffle-container.js";
import { hideCards, revealCards } from "../../actions/general/reveal-and-hide.js";
import { hidePrizesButton, revealPrizesButton, sCard, shufflePrizesButton } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

shufflePrizesButton.addEventListener('click', () => {
    shuffleContainer(sCard.user, 'prizes', 'prizes_html');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' shuffled prizes', 'player');
});

revealPrizesButton.addEventListener('click', () => {
    revealCards(sCard.user, 'prizes', 'prizes_html');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' looked at prizes', 'player');
});

hidePrizesButton.addEventListener('click', () => {
    hideCards(sCard.user, 'prizes', 'prizes_html');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' hid prizes', 'player');
});

