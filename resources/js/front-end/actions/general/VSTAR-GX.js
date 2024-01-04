import { oppGXButton, oppVSTARButton, systemState, selfGXButton, selfVSTARButton, socket } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";

export const VSTARGXFunction = (user, type, emit = true) => {
    let button;
    if (user === 'self'){
        if (type === 'GX'){
            button = selfGXButton;
        } else {
            button = selfVSTARButton;
        };
    } else {
        if (type === 'GX'){
            button = oppGXButton;
        } else {
            button = oppVSTARButton;
        };
    };
    if (button.classList.contains('used')){
        button.classList.remove('used');
        const message = determineUsername(user) + ' reset their ' + type;
        appendMessage(user, message, 'player', false);
        if (systemState.isTwoPlayer && emit){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId : systemState.roomId,
                user : oUser,
                type: type,
                emit : false
            };
            socket.emit('VSTARGXFunction', data);
        };
    } else {
        button.classList.add('used');
        const message = determineUsername(user) + ' used their ' + type + '!';
        appendMessage(user, message, 'player', false);
        if (systemState.isTwoPlayer && emit){
            const oUser = user === 'self' ? 'opp' : 'self';
            const data = {
                roomId : systemState.roomId,
                user : oUser,
                type: type,
                emit : false
            }
            socket.emit('VSTARGXFunction', data);
        };
    };
}