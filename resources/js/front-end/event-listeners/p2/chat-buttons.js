import { resetCounters } from "../../actions/counters/reset-ability-counters.js";
import { p2AttackButton, POV, p2PassButton} from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

p2AttackButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' attacked!';
    appendMessage(user, message, 'announcement');
});

p2PassButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'announcement');
});