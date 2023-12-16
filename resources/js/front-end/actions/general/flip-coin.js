import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineUsername } from '../../setup/general/determine-username.js';

export const flipCoin = (user, result) => {
    const randomValue = Math.random();
    const coinFlipResult = result !== undefined ? result : (randomValue < 0.5 ? 'heads' : 'tails');
    const message = determineUsername(user) + ' flipped ' + coinFlipResult;
    appendMessage(user, message, 'announcement');
}


