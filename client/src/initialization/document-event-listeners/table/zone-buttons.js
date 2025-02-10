import {
  closeDisplay,
  discardAll,
  handAll,
  leaveAll,
  lostZoneAll,
  shuffleAll,
  shuffleBottom,
  sort,
} from '../../../actions/zones/general.js';
import {
  oppContainerDocument,
  selfContainerDocument,
  systemState,
} from '../../../front-end.js';

export const initializeZoneButtons = () => {
  // Self buttons
  const selfShuffleDeckButton =
    selfContainerDocument.getElementById('shuffleDeckButton');
  selfShuffleDeckButton.addEventListener('click', () =>
    shuffleAll('self', systemState.initiator, 'deck')
  );

  const selfShuffleDiscardButton = selfContainerDocument.getElementById(
    'shuffleDiscardButton'
  );
  selfShuffleDiscardButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to shuffle all cards into the deck?')) {
      shuffleAll('self', systemState.initiator, 'discard');
    }
  });

  const selfDiscardAttachedCardsButton = selfContainerDocument.getElementById(
    'discardAttachedCardsButton'
  );
  selfDiscardAttachedCardsButton.addEventListener('click', () =>
    discardAll('self', systemState.initiator, 'attachedCards')
  );

  const selfShuffleAttachedCardsButton = selfContainerDocument.getElementById(
    'shuffleAttachedCardsButton'
  );
  selfShuffleAttachedCardsButton.addEventListener('click', () =>
    shuffleAll('self', systemState.initiator, 'attachedCards')
  );

  const selfLostZoneAttachedCardsButton = selfContainerDocument.getElementById(
    'lostZoneAttachedCardsButton'
  );
  selfLostZoneAttachedCardsButton.addEventListener('click', () =>
    lostZoneAll('self', systemState.initiator, 'attachedCards')
  );

  const selfHandAttachedCardsButton = selfContainerDocument.getElementById(
    'handAttachedCardsButton'
  );
  selfHandAttachedCardsButton.addEventListener('click', () =>
    handAll('self', systemState.initiator, 'attachedCards')
  );

  const selfLeaveAttachedCardsButton = selfContainerDocument.getElementById(
    'leaveAttachedCardsButton'
  );
  selfLeaveAttachedCardsButton.addEventListener('click', () =>
    leaveAll('self', systemState.initiator, 'attachedCards')
  );

  const selfDiscardViewCardsButton = selfContainerDocument.getElementById(
    'discardViewCardsButton'
  );
  selfDiscardViewCardsButton.addEventListener('click', () =>
    discardAll('self', systemState.initiator, 'viewCards')
  );

  const selfShuffleViewCardsButton = selfContainerDocument.getElementById(
    'shuffleViewCardsButton'
  );
  selfShuffleViewCardsButton.addEventListener('click', () =>
    shuffleAll('self', systemState.initiator, 'viewCards')
  );

  const selfShuffleBottomViewCardsButton = selfContainerDocument.getElementById(
    'shuffleBottomViewCardsButton'
  );
  selfShuffleBottomViewCardsButton.addEventListener('click', () =>
    shuffleBottom('self', systemState.initiator, 'viewCards')
  );

  const selfLostZoneViewCardsButton = selfContainerDocument.getElementById(
    'lostZoneViewCardsButton'
  );
  selfLostZoneViewCardsButton.addEventListener('click', () =>
    lostZoneAll('self', systemState.initiator, 'viewCards')
  );

  const selfHandViewCardsButton = selfContainerDocument.getElementById(
    'handViewCardsButton'
  );
  selfHandViewCardsButton.addEventListener('click', () =>
    handAll('self', systemState.initiator, 'viewCards')
  );

  const selfCloseDeckButton =
    selfContainerDocument.getElementById('closeDeckButton');
  selfCloseDeckButton.addEventListener('click', () =>
    closeDisplay('self', 'deck')
  );

  const selfCloseDiscardButton =
    selfContainerDocument.getElementById('closeDiscardButton');
  selfCloseDiscardButton.addEventListener('click', () =>
    closeDisplay('self', 'discard')
  );

  const selfCloseLostZoneButton = selfContainerDocument.getElementById(
    'closeLostZoneButton'
  );
  selfCloseLostZoneButton.addEventListener('click', () =>
    closeDisplay('self', 'lostZone')
  );

  const selfSortHandCheckbox =
    selfContainerDocument.getElementById('sortHandCheckbox');
  selfSortHandCheckbox.addEventListener('change', () => sort('self', 'hand'));

  const selfSortDeckCheckbox =
    selfContainerDocument.getElementById('sortDeckCheckbox');
  selfSortDeckCheckbox.addEventListener('change', () => sort('self', 'deck'));

  const selfSortDiscardCheckbox = selfContainerDocument.getElementById(
    'sortDiscardCheckbox'
  );
  selfSortDiscardCheckbox.addEventListener('change', () =>
    sort('self', 'discard')
  );

  const selfSortLostZoneCheckbox = selfContainerDocument.getElementById(
    'sortLostZoneCheckbox'
  );
  selfSortLostZoneCheckbox.addEventListener('change', () =>
    sort('self', 'lostZone')
  );

  // Opp buttons
  const oppShuffleDeckButton =
    oppContainerDocument.getElementById('shuffleDeckButton');
  oppShuffleDeckButton.addEventListener('click', () =>
    shuffleAll('opp', systemState.initiator, 'deck')
  );

  const oppShuffleDiscardButton = oppContainerDocument.getElementById(
    'shuffleDiscardButton'
  );
  oppShuffleDiscardButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to shuffle all cards into the deck?')) {
      shuffleAll('opp', systemState.initiator, 'discard');
    }
  });

  const oppDiscardAttachedCardsButton = oppContainerDocument.getElementById(
    'discardAttachedCardsButton'
  );
  oppDiscardAttachedCardsButton.addEventListener('click', () =>
    discardAll('opp', systemState.initiator, 'attachedCards')
  );

  const oppShuffleAttachedCardsButton = oppContainerDocument.getElementById(
    'shuffleAttachedCardsButton'
  );
  oppShuffleAttachedCardsButton.addEventListener('click', () =>
    shuffleAll('opp', systemState.initiator, 'attachedCards')
  );

  const oppLostZoneAttachedCardsButton = oppContainerDocument.getElementById(
    'lostZoneAttachedCardsButton'
  );
  oppLostZoneAttachedCardsButton.addEventListener('click', () =>
    lostZoneAll('opp', systemState.initiator, 'attachedCards')
  );

  const oppHandAttachedCardsButton = oppContainerDocument.getElementById(
    'handAttachedCardsButton'
  );
  oppHandAttachedCardsButton.addEventListener('click', () =>
    handAll('opp', systemState.initiator, 'attachedCards')
  );

  const oppLeaveAttachedCardsButton = oppContainerDocument.getElementById(
    'leaveAttachedCardsButton'
  );
  oppLeaveAttachedCardsButton.addEventListener('click', () =>
    leaveAll('opp', systemState.initiator, 'attachedCards')
  );

  const oppDiscardViewCardsButton = oppContainerDocument.getElementById(
    'discardViewCardsButton'
  );
  oppDiscardViewCardsButton.addEventListener('click', () =>
    discardAll('opp', systemState.initiator, 'viewCards')
  );

  const oppShuffleViewCardsButton = oppContainerDocument.getElementById(
    'shuffleViewCardsButton'
  );
  oppShuffleViewCardsButton.addEventListener('click', () =>
    shuffleAll('opp', systemState.initiator, 'viewCards')
  );

  const oppShuffleBottomViewCardsButton = oppContainerDocument.getElementById(
    'shuffleBottomViewCardsButton'
  );
  oppShuffleBottomViewCardsButton.addEventListener('click', () =>
    shuffleBottom('opp', systemState.initiator, 'viewCards')
  );

  const oppLostZoneViewCardsButton = oppContainerDocument.getElementById(
    'lostZoneViewCardsButton'
  );
  oppLostZoneViewCardsButton.addEventListener('click', () =>
    lostZoneAll('opp', systemState.initiator, 'viewCards')
  );

  const oppHandViewCardsButton = oppContainerDocument.getElementById(
    'handViewCardsButton'
  );
  oppHandViewCardsButton.addEventListener('click', () =>
    handAll('opp', systemState.initiator, 'viewCards')
  );

  const oppCloseDeckButton =
    oppContainerDocument.getElementById('closeDeckButton');
  oppCloseDeckButton.addEventListener('click', () =>
    closeDisplay('opp', 'deck')
  );

  const oppCloseDiscardButton =
    oppContainerDocument.getElementById('closeDiscardButton');
  oppCloseDiscardButton.addEventListener('click', () =>
    closeDisplay('opp', 'discard')
  );

  const oppCloseLostZoneButton = oppContainerDocument.getElementById(
    'closeLostZoneButton'
  );
  oppCloseLostZoneButton.addEventListener('click', () =>
    closeDisplay('opp', 'lostZone')
  );

  const oppSortHandCheckbox =
    oppContainerDocument.getElementById('sortHandCheckbox');
  oppSortHandCheckbox.addEventListener('change', () => sort('opp', 'hand'));

  const oppSortDeckCheckbox =
    oppContainerDocument.getElementById('sortDeckCheckbox');
  oppSortDeckCheckbox.addEventListener('change', () => sort('opp', 'deck'));

  const oppSortDiscardCheckbox = oppContainerDocument.getElementById(
    'sortDiscardCheckbox'
  );
  oppSortDiscardCheckbox.addEventListener('change', () =>
    sort('opp', 'discard')
  );

  const oppSortLostZoneCheckbox = oppContainerDocument.getElementById(
    'sortLostZoneCheckbox'
  );
  oppSortLostZoneCheckbox.addEventListener('change', () =>
    sort('opp', 'lostZone')
  );
};
