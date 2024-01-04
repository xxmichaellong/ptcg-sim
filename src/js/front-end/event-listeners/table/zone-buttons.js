import { closeDisplay, discardAll, handAll, leaveAll, lostZoneAll, shuffleAll } from '../../actions/zones/general.js';
import { sort } from '../../actions/general/sort.js';
import { oppDiscardAttachedCardsButton, oppHandAttachedCardsButton, oppLeaveAttachedCardsButton, oppLostZoneAttachedCardsButton, oppShuffleAttachedCardsButton, oppCloseDeckButton, oppCloseDiscardButton, oppCloseLostZoneButton, oppSortDeckCheckbox, oppShuffleDiscardButton, oppSortDiscardCheckbox, oppSortLostZoneCheckbox, oppShuffleDeckButton, oppDiscardViewCardsButton, oppHandViewCardsButton, oppLostZoneViewCardsButton, oppShuffleViewCardsButton, selfDiscardAttachedCardsButton, selfHandAttachedCardsButton, selfLeaveAttachedCardsButton, selfLostZoneAttachedCardsButton, selfShuffleAttachedCardsButton, selfCloseDeckButton, selfCloseDiscardButton, selfCloseLostZoneButton, selfSortDeckCheckbox, selfShuffleDiscardButton, selfSortDiscardCheckbox, selfSortLostZoneCheckbox, selfShuffleDeckButton, selfDiscardViewCardsButton, selfHandViewCardsButton, selfLostZoneViewCardsButton, selfShuffleViewCardsButton } from '../../front-end.js';

//self buttons
selfShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event));

selfShuffleDiscardButton.addEventListener('click', (event) => shuffleAll(event));

selfDiscardAttachedCardsButton.addEventListener('click', (event) => discardAll(event));

selfShuffleAttachedCardsButton.addEventListener('click', (event) => shuffleAll(event));

selfLostZoneAttachedCardsButton.addEventListener('click', (event) => lostZoneAll(event));

selfHandAttachedCardsButton.addEventListener('click', (event) => handAll(event));

selfLeaveAttachedCardsButton.addEventListener('click', (event) => leaveAll(event));

selfDiscardViewCardsButton.addEventListener('click', (event) => discardAll(event));

selfShuffleViewCardsButton.addEventListener('click', (event) => shuffleAll(event));

selfLostZoneViewCardsButton.addEventListener('click', (event) => lostZoneAll(event));

selfHandViewCardsButton.addEventListener('click', (event) => handAll(event));

selfCloseDeckButton.addEventListener('click', (event) => closeDisplay(event));

selfCloseDiscardButton.addEventListener('click', (event) => closeDisplay(event));

selfCloseLostZoneButton.addEventListener('click', (event) => closeDisplay(event));

selfSortDeckCheckbox.addEventListener('change', () => sort('self', 'deckArray', 'deckElement'));
selfSortDiscardCheckbox.addEventListener('change', () => sort('self', 'discardArray', 'discardElement'));
selfSortLostZoneCheckbox.addEventListener('change', () => sort('self', 'lostZoneArray', 'lostZoneElement'));

//opp buttons
oppShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event));

oppShuffleDiscardButton.addEventListener('click', (event) => shuffleAll(event));

oppDiscardAttachedCardsButton.addEventListener('click', (event) => discardAll(event));

oppShuffleAttachedCardsButton.addEventListener('click', (event) => shuffleAll(event));

oppLostZoneAttachedCardsButton.addEventListener('click', (event) => lostZoneAll(event));

oppHandAttachedCardsButton.addEventListener('click', (event) => handAll(event));

oppLeaveAttachedCardsButton.addEventListener('click', (event) => leaveAll(event));

oppDiscardViewCardsButton.addEventListener('click', (event) => discardAll(event));

oppShuffleViewCardsButton.addEventListener('click', (event) => shuffleAll(event));

oppLostZoneViewCardsButton.addEventListener('click', (event) => lostZoneAll(event));

oppHandViewCardsButton.addEventListener('click', (event) => handAll(event));

oppCloseDeckButton.addEventListener('click', (event) => closeDisplay(event));

oppCloseDiscardButton.addEventListener('click', (event) => closeDisplay(event));

oppCloseLostZoneButton.addEventListener('click', (event) => closeDisplay(event));

oppSortDeckCheckbox.addEventListener('change', () => sort('opp', 'deckArray', 'deckElement'));
oppSortDiscardCheckbox.addEventListener('change', () => sort('opp', 'discardArray', 'discardElement'));
oppSortLostZoneCheckbox.addEventListener('change', () => sort('opp', 'lostZoneArray', 'lostZoneElement'));
