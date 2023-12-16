import { drawButton, sCard, shuffleDeckButton, viewBottomButton, viewTopButton } from '../../front-end.js'
import { draw, handleViewButtonClick, shuffleDeck} from '../../actions/container/deck-actions.js';

shuffleDeckButton.addEventListener('click', () => {shuffleDeck(sCard.user)});

drawButton.addEventListener('click', () => {draw(sCard.user)});

viewTopButton.addEventListener('click', () => handleViewButtonClick(sCard.user, true));

viewBottomButton.addEventListener('click', () => handleViewButtonClick(sCard.user, false));






