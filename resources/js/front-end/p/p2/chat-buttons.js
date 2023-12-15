import { p2AttackButton, POV, p2PassButton, p1, socket, roomId } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

p2AttackButton.addEventListener('click', () => {
    const user = POV.user;
    const message = determineUsername(user) + ' attacked!';
    appendMessage(user, message, 'announcement');
    if (!p1[0]){
        const data = {
            roomId : roomId,
            user: POV.oUser,
            message: message,
            type: 'announcement'
        };
        socket.emit('appendMessage', data);
    };
});

p2PassButton.addEventListener('click', () => {
    const user = POV.user;
    const message = determineUsername(user) + ' passed';
    appendMessage(user, message, 'announcement');
    if (!p1[0]){
        const data = {
            roomId : roomId,
            user: POV.oUser,
            message: message,
            type: 'announcement'
        };
        socket.emit('appendMessage', data);
    };
});