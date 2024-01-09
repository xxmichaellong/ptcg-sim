import { oppContainerDocument, selfContainerDocument, socket, systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { determineUsername } from "../../setup/general/determine-username.js";

export const VSTARGXFunction = (user, type, emit = true) => {
    const selfGXButton = selfContainerDocument.getElementById('GXButton');
    const selfVSTARButton = selfContainerDocument.getElementById('VSTARButton');
    const oppGXButton = oppContainerDocument.getElementById('GXButton');
    const oppVSTARButton = oppContainerDocument.getElementById('VSTARButton');

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
    if (button.classList.contains('used-special-move')){
        button.classList.remove('used-special-move');
        const message = determineUsername(user) + ' reset their ' + type;
        appendMessage(user, message, 'player', false);
    } else {
        button.classList.add('used-special-move');
        const message = determineUsername(user) + ' used their ' + type + '!';
        appendMessage(user, message, 'player', false);
    };
    
    if (systemState.isTwoPlayer && emit){
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: user,
            type: type,
            emit: false
        };
        socket.emit('VSTARGXFunction', data);
    };
}