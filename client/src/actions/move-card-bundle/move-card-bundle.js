import { systemState } from '../../front-end.js';
import { processAction } from '../../setup/general/process-action.js';
import { refreshBoard } from '../../setup/sizing/refresh-board.js';
import { moveCardMessage } from './move-card-message.js';
import { moveCard } from './move-card.js';

export const moveCardBundle = (
  user,
  initiator,
  oZoneId,
  dZoneId,
  index,
  targetIndex,
  action,
  emit = true
) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'moveCardBundle', [
      oInitiator,
      oZoneId,
      dZoneId,
      index,
      targetIndex,
      action,
    ]);
    return;
  }
  moveCardMessage(
    user,
    initiator,
    oZoneId,
    dZoneId,
    index,
    targetIndex,
    action
  );
  moveCard(user, initiator, oZoneId, dZoneId, index, targetIndex);
  refreshBoard(); //refreshing the board rearranges the array of the cards on the active/bench. to prevent desyncs, refresh the board whenever a user moves a card to ensure that the array for both users is the same
  // the issue arised when one player would refresh their board by flipping board/resizing window, changing their arrays, but the other player would still have the original arrays.
  processAction(user, emit, 'moveCardBundle', [
    oInitiator,
    oZoneId,
    dZoneId,
    index,
    targetIndex,
    action,
  ]);
};
