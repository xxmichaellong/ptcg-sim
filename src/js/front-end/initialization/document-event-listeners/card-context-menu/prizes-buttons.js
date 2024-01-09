import { hideCards, lookAtCards, revealCards, stopLookingAtCards } from "../../../actions/general/reveal-and-hide.js";
import { shuffleZone } from "../../../actions/zones/shuffle-zone.js";
import { mouseClick, systemState } from "../../../front-end.js";

export const initializePrizesButtons = () => {
    const rootDirectory = window.location.origin;

    const shufflePrizesButton = document.getElementById('shufflePrizesButton');
    shufflePrizesButton.addEventListener('click', () => {
        shuffleZone(systemState.initiator, mouseClick.cardUser, 'prizes');
    });

    const lookPrizesButton = document.getElementById('lookPrizesButton');
    lookPrizesButton.addEventListener('click', () => {
        if (mouseClick.card.image.src === rootDirectory + '/src/cardback.png') {
            lookAtCards(systemState.initiator, mouseClick.cardUser, 'prizes');
        } else {
            stopLookingAtCards(systemState.initiator, mouseClick.cardUser, 'prizes');
        };
    });

    const revealHidePrizesButton = document.getElementById('revealHidePrizesButton');
    revealHidePrizesButton.addEventListener('click', () => {
        if (mouseClick.card.image.src === rootDirectory + '/src/cardback.png') {
            revealCards(systemState.initiator, mouseClick.cardUser, 'prizes');
        } else {
            hideCards(systemState.initiator, mouseClick.cardUser, 'prizes');
        };
    });
};