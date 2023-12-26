import { closeDisplay, discardAll, handAll, lostzoneAll, shuffleAll } from '../../actions/container/general.js';
import { sort } from '../../actions/general/sort.js';
import { oppAttachedCardDiscardButton, oppAttachedCardHandButton, oppAttachedCardLostzoneButton, oppAttachedCardShuffleButton, oppCloseDeckDisplayButton, oppCloseDiscardDisplayButton, oppCloseLostzoneDisplayButton, oppDeckSortCheckBox, oppDiscardShuffleButton, oppDiscardSortCheckBox, oppLostzoneSortCheckBox, oppShuffleDeckButton, oppViewCardsDiscardButton, oppViewCardsHandButton, oppViewCardsLostzoneButton, oppViewCardsShuffleButton, selfAttachedCardDiscardButton, selfAttachedCardHandButton, selfAttachedCardLostzoneButton, selfAttachedCardShuffleButton, selfCloseDeckDisplayButton, selfCloseDiscardDisplayButton, selfCloseLostzoneDisplayButton, selfDeckSortCheckBox, selfDiscardShuffleButton, selfDiscardSortCheckBox, selfLostzoneSortCheckBox, selfShuffleDeckButton, selfViewCardsDiscardButton, selfViewCardsHandButton, selfViewCardsLostzoneButton, selfViewCardsShuffleButton } from '../../front-end.js';

//self buttons
selfShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event));

selfDiscardShuffleButton.addEventListener('click', (event) => shuffleAll(event));

selfAttachedCardDiscardButton.addEventListener('click', (event) => discardAll(event));

selfAttachedCardShuffleButton.addEventListener('click', (event) => shuffleAll(event));

selfAttachedCardLostzoneButton.addEventListener('click', (event) => lostzoneAll(event));

selfAttachedCardHandButton.addEventListener('click', (event) => handAll(event));

selfViewCardsDiscardButton.addEventListener('click', (event) => discardAll(event));

selfViewCardsShuffleButton.addEventListener('click', (event) => shuffleAll(event));

selfViewCardsLostzoneButton.addEventListener('click', (event) => lostzoneAll(event));

selfViewCardsHandButton.addEventListener('click', (event) => handAll(event));

selfCloseDeckDisplayButton.addEventListener('click', (event) => closeDisplay(event));

selfCloseDiscardDisplayButton.addEventListener('click', (event) => closeDisplay(event));

selfCloseLostzoneDisplayButton.addEventListener('click', (event) => closeDisplay(event));

selfDeckSortCheckBox.addEventListener('change', () => sort('self', 'deck', 'deck_html'));
selfDiscardSortCheckBox.addEventListener('change', () => sort('self', 'discard', 'discard_html'));
selfLostzoneSortCheckBox.addEventListener('change', () => sort('self', 'lostzone', 'lostzone_html'));

//opp buttons
oppShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event));

oppDiscardShuffleButton.addEventListener('click', (event) => shuffleAll(event));

oppAttachedCardDiscardButton.addEventListener('click', (event) => discardAll(event));

oppAttachedCardShuffleButton.addEventListener('click', (event) => shuffleAll(event));

oppAttachedCardLostzoneButton.addEventListener('click', (event) => lostzoneAll(event));

oppAttachedCardHandButton.addEventListener('click', (event) => handAll(event));

oppViewCardsDiscardButton.addEventListener('click', (event) => discardAll(event));

oppViewCardsShuffleButton.addEventListener('click', (event) => shuffleAll(event));

oppViewCardsLostzoneButton.addEventListener('click', (event) => lostzoneAll(event));

oppViewCardsHandButton.addEventListener('click', (event) => handAll(event));

oppCloseDeckDisplayButton.addEventListener('click', (event) => closeDisplay(event));

oppCloseDiscardDisplayButton.addEventListener('click', (event) => closeDisplay(event));

oppCloseLostzoneDisplayButton.addEventListener('click', (event) => closeDisplay(event));

oppDeckSortCheckBox.addEventListener('change', () => sort('opp', 'deck', 'deck_html'));
oppDiscardSortCheckBox.addEventListener('change', () => sort('opp', 'discard', 'discard_html'));
oppLostzoneSortCheckBox.addEventListener('change', () => sort('opp', 'lostzone', 'lostzone_html'));
