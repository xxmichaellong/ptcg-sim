import { resetCounters } from "../../../actions/counters/reset-ability-counters.js";
import { discardBoard } from "../../../actions/general/board-actions.js";
import { p2AttackButton, systemState, p2PassButton, p2MessageInput, p2FREEBUTTON} from "../../../front-end.js";
import { appendMessage } from "../../../setup/chatbox/messages.js";
import { determineUsername } from "../../../setup/general/determine-username.js";

p2AttackButton.addEventListener('click', () => {
    resetCounters();
    const user = systemState.pov.user;
    const message = determineUsername(user) + ' attacked';
    appendMessage(user, message, 'player');
    discardBoard(user, false);
});

p2PassButton.addEventListener('click', () => {
    resetCounters();
    const user = systemState.pov.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'player');
    discardBoard(user, false);
});
p2MessageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        const message = p2MessageInput.value.trim();
        if (message !== '') {
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ': ' + message, 'message');
            p2MessageInput.value = '';
        };
    }
});

p2FREEBUTTON.addEventListener('click', () => {
    appendMessage(systemState.pov.user, p2FREEBUTTON.textContent, 'player');
});