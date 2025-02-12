import { systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { processAction } from '../../setup/general/process-action.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { resetAbilityCounters } from '../counters/reset-counters.js';
import { moveCard } from '../move-card-bundle/move-card.js';
import { discardBoard } from './board-actions.js';

export const takeTurn = (user, initiator, emit = true) => {
  const oInitiator = initiator === 'self' ? 'opp' : 'self';
  if (user === 'opp' && emit && systemState.isTwoPlayer) {
    processAction(user, emit, 'takeTurn', [oInitiator]);
    return;
  }

  const deck = getZone(user, 'deck');
  discardBoard(initiator, 'self', false, false);
  discardBoard(initiator, 'opp', false, false);
  resetAbilityCounters();

  if (deck.getCount() > 0) {
    systemState.turn++;
    moveCard(user, initiator, 'deck', 'hand', 0);
    appendMessage('', 'Turn ' + systemState.turn, 'announcement', false);

    ['active', 'bench'].forEach((zoneId) => {
      ['self', 'opp'].forEach((user) => {
        const zone = getZone(user, zoneId);
        Array.from(zone.element.querySelectorAll('img')).forEach((image) => {
          if (image.faceDown) {
            image.src = image.src2;
            image.faceDown = false;
            const card = zone.array.find((card) => card.image === image);
            appendMessage(
              user,
              determineUsername(user) +
                ' revealed ' +
                card.name +
                ' in ' +
                determineUsername(user) +
                "'s " +
                zoneId,
              'player',
              false
            );
          }
        });
      });
    });

    appendMessage(
      initiator,
      determineUsername(initiator) + ' drew for turn',
      'player',
      false
    );
  } else {
    appendMessage(
      '',
      determineUsername(initiator) + ' has no more cards in deck!',
      'announcement',
      false
    );
  }

  processAction(user, emit, 'takeTurn', [oInitiator]);
};
