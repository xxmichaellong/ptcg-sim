import { reset } from "../../actions/general/reset.js";
import { systemState } from "../../front-end.js";
import { appendMessage } from "../chatbox/append-message.js";
import { processAction } from "../general/process-action.js";

export const exchangeData = (user, username, deckData, callback = true, emit = true) => {
    if (user === 'self'){
        reset('self', true, true, false, false);
    } else if (user === 'opp'){
        systemState.p2OppUsername = username;
        systemState.p2OppDeckData = deckData;
        appendMessage('', systemState.p2OppUsername + ' joined', 'announcement', false);
        reset('opp', true, true, false, false);

        if (callback){
            exchangeData('self', systemState.p2SelfUsername, systemState.selfDeckData, false);
        };
    };
    processAction(user, emit, 'exchangeData', [username, deckData, callback]);
}