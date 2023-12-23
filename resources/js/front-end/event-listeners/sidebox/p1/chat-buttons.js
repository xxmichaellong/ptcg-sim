import { resetCounters } from "../../../actions/counters/reset-ability-counters.js";
import { sort } from "../../../actions/general/sort.js";
import { attackButton, POV, passButton, messageInput, FREEBUTTON} from "../../../front-end.js";
import { appendMessage } from "../../../setup/chatbox/messages.js";
import { determineUsername } from "../../../setup/general/determine-username.js";

attackButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' attacked';
    appendMessage(user, message, 'player');
});
passButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'player');
});
messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        const message = messageInput.value.trim();
        if (message !== '') {
            appendMessage(POV.user, determineUsername(POV.user) + ': ' + message, 'message');
            messageInput.value = '';
        };
    }
});

FREEBUTTON.addEventListener('click', () => {
    appendMessage(POV.user, FREEBUTTON.textContent, 'player');
    sort('self');
});