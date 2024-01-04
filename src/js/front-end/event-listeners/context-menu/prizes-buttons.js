import { shuffleZone } from "../../actions/zones/shuffle-zone.js";
import { hideCards, hideShortcut, revealCards, revealShortcut } from "../../actions/general/reveal-and-hide.js";
import { lookPrizesButton, oppPrizesArray, prizesArray, revealHidePrizesButton, sCard, shufflePrizesButton } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { getZoneCount } from "../../actions/general/count.js";

let rootDirectory = window.location.origin;

shufflePrizesButton.addEventListener('click', () => {
    shuffleZone(sCard.user, 'prizesArray', 'prizesElement');
    appendMessage(sCard.user, determineUsername(sCard.user) + ' shuffled prizes', 'player');
});

lookPrizesButton.addEventListener('click', () => {
    if (sCard.card.image.src === rootDirectory + '/src/cardback.png'){
        revealCards(sCard.user, 'prizesArray', 'prizesElement');
        appendMessage(sCard.user, determineUsername(sCard.user) + ' looked at prizes', 'player');
    } else {
        hideCards(sCard.user, 'prizesArray', 'prizesElement');
        appendMessage(sCard.user, determineUsername(sCard.user) + ' stopped looking at prizes', 'player');
    };
});

revealHidePrizesButton.addEventListener('click', () => {
    const prizesCount = sCard.user === 'self' ? getZoneCount(prizesArray) : getZoneCount(oppPrizesArray);

    if (sCard.card.image.src === rootDirectory + '/src/cardback.png'){
        for (let i = 0; i < prizesCount; i++){
            revealShortcut(sCard.user, sCard.zoneArrayString, i, false);
        };
        appendMessage(sCard.user, determineUsername(sCard.user) + ' revealed prizes', 'player');
    } else {
        for (let i = 0; i < prizesCount; i++){
            hideShortcut(sCard.user, sCard.zoneArrayString, i, false);
        };
        appendMessage(sCard.user, determineUsername(sCard.user) + ' hid prizes', 'player');
    };
});
