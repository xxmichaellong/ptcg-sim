import { oppContainerDocument, selfContainerDocument, systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { processAction } from "../../setup/general/process-action.js";

export const VSTARGXFunction = (user, type, emit = true) => {
    if (user === 'opp' && emit && systemState.isTwoPlayer){
        processAction(user, emit, 'VSTARGXFunction', [type]);
        return;
    };
    
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
    
    processAction(user, emit, 'VSTARGXFunction', [type]);
}