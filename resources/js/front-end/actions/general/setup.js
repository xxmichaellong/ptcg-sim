import { appendMessage } from '../../setup/chatbox/messages.js';
import { drawHand } from '../container/hand-actions.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { reset } from './reset.js';
import { shuffleContainer } from '../container/shuffle-container.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';

export const setup = (user) => {
    reset(user, true);
    if (determineDeckData(user)){
        shuffleContainer(user, 'deck', 'deck_html');
        drawHand(user);
        appendMessage(user, determineUsername(user) + ' setup', 'player');
    };
};
