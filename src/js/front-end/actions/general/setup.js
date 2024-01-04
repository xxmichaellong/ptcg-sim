import { appendMessage } from '../../setup/chatbox/messages.js';
import { drawHand } from '../zones/hand-actions.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { reset } from './reset.js';
import { shuffleZone } from '../zones/shuffle-zone.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';

export const setup = (user) => {
    reset(user, true);
    if (determineDeckData(user)){
        shuffleZone(user, 'deckArray', 'deckElement');
        drawHand(user);
        appendMessage(user, determineUsername(user) + ' setup', 'player');
    };
};
