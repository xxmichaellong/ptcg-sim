import { socket, systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { resetAbilityCounters } from "../counters/reset-counters.js";
import { discardBoard } from "../general/board-actions.js";

export const attack = (initiator, emit = true) => {
    resetAbilityCounters();
    const message = determineUsername(initiator) + ' attacked';
    appendMessage(initiator, message, 'player', false);
    discardBoard(initiator, initiator, false, false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            emit: false
        };
        socket.emit('attack', data);
    };
}

export const pass = (initiator, emit = true) => {
    resetAbilityCounters();
    const message = determineUsername(initiator) + ' passed';
    appendMessage(initiator, message, 'player', false);
    discardBoard(initiator, initiator, false, false);

    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            emit: false
        };
        socket.emit('pass', data);
    };
}