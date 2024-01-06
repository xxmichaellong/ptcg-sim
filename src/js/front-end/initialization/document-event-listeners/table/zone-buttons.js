import { closeDisplay, discardAll, handAll, leaveAll, lostZoneAll, shuffleAll, sort } from '../../../actions/zones/general.js';
import { oppContainerDocument, selfContainerDocument } from '../../../front-end.js';

export const initializeZoneButtons = () => {
    // Self buttons
    const selfShuffleDeckButton = selfContainerDocument.getElementById('shuffleDeckButton');
    selfShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event, 'self', 'deck'));

    const selfShuffleDiscardButton = selfContainerDocument.getElementById('shuffleDiscardButton');
    selfShuffleDiscardButton.addEventListener('click', (event) => shuffleAll(event, 'self', 'discard'));

    const selfDiscardAttachedCardsButton = selfContainerDocument.getElementById('discardAttachedCardsButton');
    selfDiscardAttachedCardsButton.addEventListener('click', (event) => discardAll(event, 'self', 'attachedCards'));

    const selfShuffleAttachedCardsButton = selfContainerDocument.getElementById('shuffleAttachedCardsButton');
    selfShuffleAttachedCardsButton.addEventListener('click', (event) => shuffleAll(event, 'self', 'attachedCards'));

    const selfLostZoneAttachedCardsButton = selfContainerDocument.getElementById('lostZoneAttachedCardsButton');
    selfLostZoneAttachedCardsButton.addEventListener('click', (event) => lostZoneAll(event, 'self', 'attachedCards'));

    const selfHandAttachedCardsButton = selfContainerDocument.getElementById('handAttachedCardsButton');
    selfHandAttachedCardsButton.addEventListener('click', (event) => handAll(event, 'self', 'attachedCards'));

    const selfLeaveAttachedCardsButton = selfContainerDocument.getElementById('leaveAttachedCardsButton');
    selfLeaveAttachedCardsButton.addEventListener('click', (event) => leaveAll(event, 'self', 'attachedCards'));

    const selfDiscardViewCardsButton = selfContainerDocument.getElementById('discardViewCardsButton');
    selfDiscardViewCardsButton.addEventListener('click', (event) => discardAll(event, 'self', 'viewCards'));

    const selfShuffleViewCardsButton = selfContainerDocument.getElementById('shuffleViewCardsButton');
    selfShuffleViewCardsButton.addEventListener('click', (event) => shuffleAll(event, 'self', 'viewCards'));

    const selfLostZoneViewCardsButton = selfContainerDocument.getElementById('lostZoneViewCardsButton');
    selfLostZoneViewCardsButton.addEventListener('click', (event) => lostZoneAll(event, 'self', 'viewCards'));

    const selfHandViewCardsButton = selfContainerDocument.getElementById('handViewCardsButton');
    selfHandViewCardsButton.addEventListener('click', (event) => handAll(event, 'self', 'viewCards'));

    const selfCloseDeckButton = selfContainerDocument.getElementById('closeDeckButton');
    selfCloseDeckButton.addEventListener('click', (event) => closeDisplay(event, 'self', 'deckElement'));

    const selfCloseDiscardButton = selfContainerDocument.getElementById('closeDiscardButton');
    selfCloseDiscardButton.addEventListener('click', (event) => closeDisplay(event, 'self', 'discard'));

    const selfCloseLostZoneButton = selfContainerDocument.getElementById('closeLostZoneButton');
    selfCloseLostZoneButton.addEventListener('click', (event) => closeDisplay(event, 'self', 'lostZone'));

    const selfSortDeckCheckbox = selfContainerDocument.getElementById('sortDeckCheckbox');
    selfSortDeckCheckbox.addEventListener('change', () => sort('self', 'deck'));

    const selfSortDiscardCheckbox = selfContainerDocument.getElementById('sortDiscardCheckbox');
    selfSortDiscardCheckbox.addEventListener('change', () => sort('self', 'discard'));

    const selfSortLostZoneCheckbox = selfContainerDocument.getElementById('sortLostZoneCheckbox');
    selfSortLostZoneCheckbox.addEventListener('change', () => sort('self', 'lostZone'));

    // Opp buttons
    const oppShuffleDeckButton = oppContainerDocument.getElementById('shuffleDeckButton');
    oppShuffleDeckButton.addEventListener('click', (event) => shuffleAll(event, 'opp', 'deck'));

    const oppShuffleDiscardButton = oppContainerDocument.getElementById('shuffleDiscardButton');
    oppShuffleDiscardButton.addEventListener('click', (event) => shuffleAll(event, 'opp', 'discard'));

    const oppDiscardAttachedCardsButton = oppContainerDocument.getElementById('discardAttachedCardsButton');
    oppDiscardAttachedCardsButton.addEventListener('click', (event) => discardAll(event, 'opp', 'attachedCards'));

    const oppShuffleAttachedCardsButton = oppContainerDocument.getElementById('shuffleAttachedCardsButton');
    oppShuffleAttachedCardsButton.addEventListener('click', (event) => shuffleAll(event, 'opp', 'attachedCards'));

    const oppLostZoneAttachedCardsButton = oppContainerDocument.getElementById('lostZoneAttachedCardsButton');
    oppLostZoneAttachedCardsButton.addEventListener('click', (event) => lostZoneAll(event, 'opp', 'attachedCards'));

    const oppHandAttachedCardsButton = oppContainerDocument.getElementById('handAttachedCardsButton');
    oppHandAttachedCardsButton.addEventListener('click', (event) => handAll(event, 'opp', 'attachedCards'));

    const oppLeaveAttachedCardsButton = oppContainerDocument.getElementById('leaveAttachedCardsButton');
    oppLeaveAttachedCardsButton.addEventListener('click', (event) => leaveAll(event, 'opp', 'attachedCards'));

    const oppDiscardViewCardsButton = oppContainerDocument.getElementById('discardViewCardsButton');
    oppDiscardViewCardsButton.addEventListener('click', (event) => discardAll(event, 'opp', 'viewCards'));

    const oppShuffleViewCardsButton = oppContainerDocument.getElementById('shuffleViewCardsButton');
    oppShuffleViewCardsButton.addEventListener('click', (event) => shuffleAll(event, 'opp', 'viewCards'));

    const oppLostZoneViewCardsButton = oppContainerDocument.getElementById('lostZoneViewCardsButton');
    oppLostZoneViewCardsButton.addEventListener('click', (event) => lostZoneAll(event, 'opp', 'viewCards'));

    const oppHandViewCardsButton = oppContainerDocument.getElementById('handViewCardsButton');
    oppHandViewCardsButton.addEventListener('click', (event) => handAll(event, 'opp', 'viewCards'));

    const oppCloseDeckButton = oppContainerDocument.getElementById('closeDeckButton');
    oppCloseDeckButton.addEventListener('click', (event) => closeDisplay(event, 'opp', 'deckElement'));

    const oppCloseDiscardButton = oppContainerDocument.getElementById('closeDiscardButton');
    oppCloseDiscardButton.addEventListener('click', (event) => closeDisplay(event, 'opp', 'discard'));

    const oppCloseLostZoneButton = oppContainerDocument.getElementById('closeLostZoneButton');
    oppCloseLostZoneButton.addEventListener('click', (event) => closeDisplay(event, 'opp', 'lostZone'));

    const oppSortDeckCheckbox = oppContainerDocument.getElementById('sortDeckCheckbox');
    oppSortDeckCheckbox.addEventListener('change', () => sort('opp', 'deck'));

    const oppSortDiscardCheckbox = oppContainerDocument.getElementById('sortDiscardCheckbox');
    oppSortDiscardCheckbox.addEventListener('change', () => sort('opp', 'discard'));

    const oppSortLostZoneCheckbox = oppContainerDocument.getElementById('sortLostZoneCheckbox');
    oppSortLostZoneCheckbox.addEventListener('change', () => sort('opp', 'lostZone'));
}