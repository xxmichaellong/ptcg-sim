import { shuffleContainer } from "../../actions/container/shuffle-container.js";
import { hideCards, revealCards } from "../../actions/general/reveal-and-hide.js";
import { hidePrizesButton, revealPrizesButton, sCard, shufflePrizesButton } from "../../front-end.js";

shufflePrizesButton.addEventListener('click', () => shuffleContainer(sCard.user, 'prizes', 'prizes_html'));

revealPrizesButton.addEventListener('click', () => revealCards(sCard.user, 'prizes', 'prizes_html'));

hidePrizesButton.addEventListener('click', () => hideCards(sCard.user, 'prizes', 'prizes_html'));

