import { closeDisplay, discardAll, handAll, lostzoneAll, shuffleAll } from '../../actions/container/general.js';
import { oppAttachedCardDiscardButton, oppAttachedCardHandButton, oppAttachedCardLostzoneButton, oppAttachedCardShuffleButton, oppCloseDeckDisplayButton, oppCloseDiscardDisplayButton, oppCloseLostzoneDisplayButton, oppDiscardShuffleButton, oppShuffleDeckButton, oppViewCardsDiscardButton, oppViewCardsHandButton, oppViewCardsLostzoneButton, oppViewCardsShuffleButton, selfAttachedCardDiscardButton, selfAttachedCardHandButton, selfAttachedCardLostzoneButton, selfAttachedCardShuffleButton, selfCloseDeckDisplayButton, selfCloseDiscardDisplayButton, selfCloseLostzoneDisplayButton, selfDiscardShuffleButton, selfShuffleDeckButton, selfViewCardsDiscardButton, selfViewCardsHandButton, selfViewCardsLostzoneButton, selfViewCardsShuffleButton } from '../../front-end.js';

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

