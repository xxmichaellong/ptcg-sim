import { shuffleContainer } from "../../actions/container/shuffle-container.js";
import { hideCards, hideShortcut, revealCards, revealShortcut } from "../../actions/general/reveal-and-hide.js";
import { lookPrizesButton, oppPrizes, prizes, revealHidePrizesButton, sCard, shufflePrizesButton } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

let rootDirectory = window.location.origin;

shufflePrizesButton.addEventListener('click', () => {
    shuffleContainer(sCard.user, 'prizes', 'prizes_html');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' shuffled prizes', 'player');
});

lookPrizesButton.addEventListener('click', () => {
    if (sCard.card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        revealCards(sCard.user, 'prizes', 'prizes_html');
        appendMessage(sCard.user, determineUsername(sCard.user) + ' looked at prizes', 'player');
    } else {
        hideCards(sCard.user, 'prizes', 'prizes_html');
        appendMessage(sCard.user, determineUsername(sCard.user) + ' stopped looking at prizes', 'player');
    };
});

revealHidePrizesButton.addEventListener('click', () => {
    const prizesCount = sCard.user === 'self' ? prizes.count : oppPrizes.count;

    if (sCard.card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        for (let i = 0; i < prizesCount; i++){
            revealShortcut(sCard.user, sCard.locationAsString, i, false);
        };
        appendMessage(sCard.user, determineUsername(sCard.user) + ' revealed prizes', 'player');
    } else {
        for (let i = 0; i < prizesCount; i++){
            hideShortcut(sCard.user, sCard.locationAsString, i, false);
        };
        appendMessage(sCard.user, determineUsername(sCard.user) + ' hid prizes', 'player');
    };
});
