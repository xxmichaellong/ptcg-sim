import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';

export const flipCoin = (initiator, result) => {
  const randomValue = Math.random();
  const coinFlipResult =
    result !== undefined ? result : randomValue < 0.5 ? 'heads' : 'tails';
  const message = determineUsername(initiator) + ' flipped ' + coinFlipResult;
  appendMessage(initiator, message, 'player');
};
