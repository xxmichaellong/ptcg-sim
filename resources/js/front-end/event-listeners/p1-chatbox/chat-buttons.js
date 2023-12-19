import { resetCounters } from "../../actions/counters/reset-ability-counters.js";
import { attackButton, POV, passButton} from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

attackButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' attacked!';
    appendMessage(user, message, 'announcement');
});
passButton.addEventListener('click', () => {
    resetCounters();
    const user = POV.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'announcement');
});