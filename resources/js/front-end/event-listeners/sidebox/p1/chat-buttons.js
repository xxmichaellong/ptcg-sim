import { resetCounters } from "../../../actions/counters/reset-ability-counters.js";
import { discardBoard } from "../../../actions/general/board-actions.js";
import { reset } from "../../../actions/general/reset.js";
import { attackButton, systemState, passButton, messageInput, FREEBUTTON} from "../../../front-end.js";
import { appendMessage } from "../../../setup/chatbox/messages.js";
import { determineUsername } from "../../../setup/general/determine-username.js";

attackButton.addEventListener('click', () => {
    resetCounters();
    const user = systemState.pov.user;
    const message = determineUsername(user) + ' attacked';
    appendMessage(user, message, 'player');
    discardBoard(user, false);
});
passButton.addEventListener('click', () => {
    resetCounters();
    const user = systemState.pov.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'player');
    discardBoard(user, false);
});
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter'){
        event.preventDefault();
        const message = messageInput.value.trim();
        if (message !== '') {
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ': ' + message, 'message');
            messageInput.value = '';
        };
    };
});

FREEBUTTON.addEventListener('click', () => {
    appendMessage(systemState.pov.user, FREEBUTTON.textContent, 'player');
    reset(user, true, false, true, false);
});