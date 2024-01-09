import { closeDisplay, discardAll, handAll, leaveAll, lostZoneAll, shuffleAll, sort } from '../../../actions/zones/general.js';
import { oppContainerDocument, selfContainerDocument, systemState } from '../../../front-end.js';

export const initializeZoneButtons = () => {
    // Self buttons
    const selfShuffleDeckButton = selfContainerDocument.getElementById('shuffleDeckButton');
    selfShuffleDeckButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'self', 'deck'));

    const selfShuffleDiscardButton = selfContainerDocument.getElementById('shuffleDiscardButton');
    selfShuffleDiscardButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'self', 'discard'));

    const selfDiscardAttachedCardsButton = selfContainerDocument.getElementById('discardAttachedCardsButton');
    selfDiscardAttachedCardsButton.addEventListener('click', () => discardAll(systemState.initiator, 'self', 'attachedCards'));

    const selfShuffleAttachedCardsButton = selfContainerDocument.getElementById('shuffleAttachedCardsButton');
    selfShuffleAttachedCardsButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'self', 'attachedCards'));

    const selfLostZoneAttachedCardsButton = selfContainerDocument.getElementById('lostZoneAttachedCardsButton');
    selfLostZoneAttachedCardsButton.addEventListener('click', () => lostZoneAll(systemState.initiator, 'self', 'attachedCards'));

    const selfHandAttachedCardsButton = selfContainerDocument.getElementById('handAttachedCardsButton');
    selfHandAttachedCardsButton.addEventListener('click', () => handAll(systemState.initiator, 'self', 'attachedCards'));

    const selfLeaveAttachedCardsButton = selfContainerDocument.getElementById('leaveAttachedCardsButton');
    selfLeaveAttachedCardsButton.addEventListener('click', () => leaveAll(systemState.initiator, 'self', 'attachedCards'));

    const selfDiscardViewCardsButton = selfContainerDocument.getElementById('discardViewCardsButton');
    selfDiscardViewCardsButton.addEventListener('click', () => discardAll(systemState.initiator, 'self', 'viewCards'));

    const selfShuffleViewCardsButton = selfContainerDocument.getElementById('shuffleViewCardsButton');
    selfShuffleViewCardsButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'self', 'viewCards'));

    const selfLostZoneViewCardsButton = selfContainerDocument.getElementById('lostZoneViewCardsButton');
    selfLostZoneViewCardsButton.addEventListener('click', () => lostZoneAll(systemState.initiator, 'self', 'viewCards'));

    const selfHandViewCardsButton = selfContainerDocument.getElementById('handViewCardsButton');
    selfHandViewCardsButton.addEventListener('click', () => handAll(systemState.initiator, 'self', 'viewCards'));

    const selfCloseDeckButton = selfContainerDocument.getElementById('closeDeckButton');
    selfCloseDeckButton.addEventListener('click', () => closeDisplay('self', 'deck'));

    const selfCloseDiscardButton = selfContainerDocument.getElementById('closeDiscardButton');
    selfCloseDiscardButton.addEventListener('click', () => closeDisplay('self', 'discard'));

    const selfCloseLostZoneButton = selfContainerDocument.getElementById('closeLostZoneButton');
    selfCloseLostZoneButton.addEventListener('click', () => closeDisplay('self', 'lostZone'));

    const selfSortDeckCheckbox = selfContainerDocument.getElementById('sortDeckCheckbox');
    selfSortDeckCheckbox.addEventListener('change', () => sort('self', 'deck'));

    const selfSortDiscardCheckbox = selfContainerDocument.getElementById('sortDiscardCheckbox');
    selfSortDiscardCheckbox.addEventListener('change', () => sort('self', 'discard'));

    const selfSortLostZoneCheckbox = selfContainerDocument.getElementById('sortLostZoneCheckbox');
    selfSortLostZoneCheckbox.addEventListener('change', () => sort('self', 'lostZone'));

    // Opp buttons
    const oppShuffleDeckButton = oppContainerDocument.getElementById('shuffleDeckButton');
    oppShuffleDeckButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'opp', 'deck'));

    const oppShuffleDiscardButton = oppContainerDocument.getElementById('shuffleDiscardButton');
    oppShuffleDiscardButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'opp', 'discard'));

    const oppDiscardAttachedCardsButton = oppContainerDocument.getElementById('discardAttachedCardsButton');
    oppDiscardAttachedCardsButton.addEventListener('click', () => discardAll(systemState.initiator, 'opp', 'attachedCards'));

    const oppShuffleAttachedCardsButton = oppContainerDocument.getElementById('shuffleAttachedCardsButton');
    oppShuffleAttachedCardsButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'opp', 'attachedCards'));

    const oppLostZoneAttachedCardsButton = oppContainerDocument.getElementById('lostZoneAttachedCardsButton');
    oppLostZoneAttachedCardsButton.addEventListener('click', () => lostZoneAll(systemState.initiator, 'opp', 'attachedCards'));

    const oppHandAttachedCardsButton = oppContainerDocument.getElementById('handAttachedCardsButton');
    oppHandAttachedCardsButton.addEventListener('click', () => handAll(systemState.initiator, 'opp', 'attachedCards'));

    const oppLeaveAttachedCardsButton = oppContainerDocument.getElementById('leaveAttachedCardsButton');
    oppLeaveAttachedCardsButton.addEventListener('click', () => leaveAll(systemState.initiator, 'opp', 'attachedCards'));

    const oppDiscardViewCardsButton = oppContainerDocument.getElementById('discardViewCardsButton');
    oppDiscardViewCardsButton.addEventListener('click', () => discardAll(systemState.initiator, 'opp', 'viewCards'));

    const oppShuffleViewCardsButton = oppContainerDocument.getElementById('shuffleViewCardsButton');
    oppShuffleViewCardsButton.addEventListener('click', () => shuffleAll(systemState.initiator, 'opp', 'viewCards'));

    const oppLostZoneViewCardsButton = oppContainerDocument.getElementById('lostZoneViewCardsButton');
    oppLostZoneViewCardsButton.addEventListener('click', () => lostZoneAll(systemState.initiator, 'opp', 'viewCards'));

    const oppHandViewCardsButton = oppContainerDocument.getElementById('handViewCardsButton');
    oppHandViewCardsButton.addEventListener('click', () => handAll(systemState.initiator, 'opp', 'viewCards'));

    const oppCloseDeckButton = oppContainerDocument.getElementById('closeDeckButton');
    oppCloseDeckButton.addEventListener('click', () => closeDisplay('opp', 'deck'));

    const oppCloseDiscardButton = oppContainerDocument.getElementById('closeDiscardButton');
    oppCloseDiscardButton.addEventListener('click', () => closeDisplay('opp', 'discard'));

    const oppCloseLostZoneButton = oppContainerDocument.getElementById('closeLostZoneButton');
    oppCloseLostZoneButton.addEventListener('click', () => closeDisplay('opp', 'lostZone'));

    const oppSortDeckCheckbox = oppContainerDocument.getElementById('sortDeckCheckbox');
    oppSortDeckCheckbox.addEventListener('change', () => sort('opp', 'deck'));

    const oppSortDiscardCheckbox = oppContainerDocument.getElementById('sortDiscardCheckbox');
    oppSortDiscardCheckbox.addEventListener('change', () => sort('opp', 'discard'));

    const oppSortLostZoneCheckbox = oppContainerDocument.getElementById('sortLostZoneCheckbox');
    oppSortLostZoneCheckbox.addEventListener('change', () => sort('opp', 'lostZone'));
}