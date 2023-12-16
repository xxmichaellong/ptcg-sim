import { attackButton, POV, passButton} from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

attackButton.addEventListener('click', () => {
    const user = POV.user;
    const message = determineUsername(user) + ' attacked!';
    appendMessage(user, message, 'announcement');
});
passButton.addEventListener('click', () => {
    const user = POV.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'announcement');
});