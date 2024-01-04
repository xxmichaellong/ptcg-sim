import { closeDisplay, discardAll, handAll, leaveAll, lostZoneAll, shuffleAll } from '../../actions/zones/general.js';
import { sort } from '../../actions/general/sort.js';
import { oppAttachedCardsDiscardButton, oppAttachedCardsHandButton, oppAttachedCardsLeaveButton, oppAttachedCardslostZoneButton, oppAttachedCardsShuffleButton, oppCloseDeckDisplayButton, oppCloseDiscardDisplayButton, oppCloselostZoneDisplayButton, oppDeckSortCheckBox, oppDiscardShuffleButton, oppDiscardSortCheckBox, opplostZoneSortCheckBox, oppShuffleDeckButton, oppViewCardsDiscardButton, oppViewCardsHandButton, oppViewCardslostZoneButton, oppViewCardsShuffleButton, selfattachedCardsDiscardButton, selfattachedCardsHandButton, selfattachedCardsLeaveButton, selfattachedCardslostZoneButton, selfattachedCardsShuffleButton, selfCloseDeckDisplayButton, selfCloseDiscardDisplayButton, selfCloselostZoneDisplayButton, selfDeckSortCheckBox, selfDiscardShuffleButton, selfDiscardSortCheckBox, selflostZoneSortCheckBox, selfShuffleDeckButton, selfViewCardsDiscardButton, selfViewCardsHandButton, selfViewCardslostZoneButton, selfViewCardsShuffleButton } from '../../front-end.js';

//self buttons
selfShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event));

selfDiscardShuffleButton.addEventListener('click', (event) => shuffleAll(event));

selfattachedCardsDiscardButton.addEventListener('click', (event) => discardAll(event));

selfattachedCardsShuffleButton.addEventListener('click', (event) => shuffleAll(event));

selfattachedCardslostZoneButton.addEventListener('click', (event) => lostZoneAll(event));

selfattachedCardsHandButton.addEventListener('click', (event) => handAll(event));

selfattachedCardsLeaveButton.addEventListener('click', (event) => leaveAll(event));

selfViewCardsDiscardButton.addEventListener('click', (event) => discardAll(event));

selfViewCardsShuffleButton.addEventListener('click', (event) => shuffleAll(event));

selfViewCardslostZoneButton.addEventListener('click', (event) => lostZoneAll(event));

selfViewCardsHandButton.addEventListener('click', (event) => handAll(event));

selfCloseDeckDisplayButton.addEventListener('click', (event) => closeDisplay(event));

selfCloseDiscardDisplayButton.addEventListener('click', (event) => closeDisplay(event));

selfCloselostZoneDisplayButton.addEventListener('click', (event) => closeDisplay(event));

selfDeckSortCheckBox.addEventListener('change', () => sort('self', 'deckArray', 'deckElement'));
selfDiscardSortCheckBox.addEventListener('change', () => sort('self', 'discardArray', 'discardElement'));
selflostZoneSortCheckBox.addEventListener('change', () => sort('self', 'lostZoneArray', 'lostZoneElement'));

//opp buttons
oppShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event));

oppDiscardShuffleButton.addEventListener('click', (event) => shuffleAll(event));

oppAttachedCardsDiscardButton.addEventListener('click', (event) => discardAll(event));

oppAttachedCardsShuffleButton.addEventListener('click', (event) => shuffleAll(event));

oppAttachedCardslostZoneButton.addEventListener('click', (event) => lostZoneAll(event));

oppAttachedCardsHandButton.addEventListener('click', (event) => handAll(event));

oppAttachedCardsLeaveButton.addEventListener('click', (event) => leaveAll(event));

oppViewCardsDiscardButton.addEventListener('click', (event) => discardAll(event));

oppViewCardsShuffleButton.addEventListener('click', (event) => shuffleAll(event));

oppViewCardslostZoneButton.addEventListener('click', (event) => lostZoneAll(event));

oppViewCardsHandButton.addEventListener('click', (event) => handAll(event));

oppCloseDeckDisplayButton.addEventListener('click', (event) => closeDisplay(event));

oppCloseDiscardDisplayButton.addEventListener('click', (event) => closeDisplay(event));

oppCloselostZoneDisplayButton.addEventListener('click', (event) => closeDisplay(event));

oppDeckSortCheckBox.addEventListener('change', () => sort('opp', 'deckArray', 'deckElement'));
oppDiscardSortCheckBox.addEventListener('change', () => sort('opp', 'discardArray', 'discardElement'));
opplostZoneSortCheckBox.addEventListener('change', () => sort('opp', 'lostZoneArray', 'lostZoneElement'));
