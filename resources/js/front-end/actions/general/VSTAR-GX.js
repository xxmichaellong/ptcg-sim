import { POV, p1, roomId, socket } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

export const VSTARGXFunction = (user, type, received = false) => {
    const message = determineUsername(user) + ' used their ' + type + '!';
    appendMessage(POV.user, message, 'announcement', true);
    if (!p1[0] && !received){
        const data = {
            roomId : roomId,
            user : POV.oUser,
            type: type,
            received : true
        }
        socket.emit('VSTARGXFunction', data);
    };
}