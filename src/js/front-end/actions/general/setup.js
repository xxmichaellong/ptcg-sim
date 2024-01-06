import { appendMessage } from '../../setup/chatbox/messages.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { drawHand } from '../zones/hand-actions.js';
import { shuffleZone } from '../zones/shuffle-zone.js';
import { reset } from './reset.js';

export const setup = (user) => {
    reset(user, true);
    if (determineDeckData(user)){
        shuffleZone(user, 'deck');
        drawHand(user);
        appendMessage(user, determineUsername(user) + ' drew starting hand and set prizes', 'player');
    };
};