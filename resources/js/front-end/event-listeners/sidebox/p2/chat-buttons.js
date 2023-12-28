import { resetCounters } from "../../../actions/counters/reset-ability-counters.js";
import { discardBoard } from "../../../actions/general/clear-board.js";
import { p2AttackButton, POV, p2PassButton, p2MessageInput, p2FREEBUTTON} from "../../../front-end.js";
import { appendMessage } from "../../../setup/chatbox/messages.js";
import { determineUsername } from "../../../setup/general/determine-username.js";

p2AttackButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' attacked';
    appendMessage(user, message, 'player');
    discardBoard(user, false);
});

p2PassButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'player');
    discardBoard(user, false);
});
p2MessageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        const message = p2MessageInput.value.trim();
        if (message !== '') {
            appendMessage(POV.user, determineUsername(POV.user) + ': ' + message, 'message');
            p2MessageInput.value = '';
        };
    }
});

p2FREEBUTTON.addEventListener('click', () => {
    appendMessage(POV.user, p2FREEBUTTON.textContent, 'player');
});