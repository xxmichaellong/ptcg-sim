import { socket, systemState } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/append-message.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { shuffleIndices } from "../../setup/general/shuffle.js";
import { getZone } from "../../setup/zones/get-zone.js";
import { moveCard } from "../move-card-bundle/move-card.js";
import { shuffleZone } from "../zones/shuffle-zone.js";

export const discardBoard = (initiator, user, message = true, emit = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(initiator, user, 'board', 'discard', 0);
        };
        if (message){
            appendMessage(initiator, determineUsername(initiator) + ' moved ' + selectedBoardCount + ' card(s) from board to discard', 'player', false)
        };
    };
    if (systemState.isTwoPlayer && emit){
        initiator = initiator === 'self' ? 'opp' : 'self';
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            initiator: initiator,
            user: user,
            message: message,
            emit: false
        };
        socket.emit('discardBoard', data);
    };
}

export const handBoard = (initiator, user, message = true, emit = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(initiator, user, 'board', 'hand', 0);
        };
        if (message){
            appendMessage(initiator, determineUsername(initiator) + ' moved ' + selectedBoardCount + ' card(s) from board to hand', 'player', false)
        };
    };
    if (systemState.isTwoPlayer && emit){
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: user,
            message: message,
            emit: false
        };
        socket.emit('handBoard', data);
    };
}

export const shuffleBoard = (initiator, user, message = true, indices, emit = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    const deck = getZone(user, 'deck');
    indices = indices ? indices : shuffleIndices(deck.getCount());

    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(initiator, user, 'board', 'deck', 0);
        };
        shuffleZone(initiator, user, 'deck', indices, false, false);
        if (message){
            appendMessage(initiator, determineUsername(initiator) + ' shuffled ' + selectedBoardCount + ' card(s) from board to deck', 'player', false);
        };
    };
    if (systemState.isTwoPlayer && emit){
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: user,
            message: message,
            indices: indices,
            emit: false
        };
        socket.emit('shuffleBoard', data);
    };
}

export const lostZoneBoard = (initiator, user, message = true, emit = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(initiator, user, 'board', 'lostZone', 0);
        };
        if (message){
            appendMessage(initiator, determineUsername(initiator) + ' moved ' + selectedBoardCount + ' card(s) from board to lost zone', 'player', false)
        };
    };
    if (systemState.isTwoPlayer && emit){
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: user,
            message: message,
            emit: false
        };
        socket.emit('lostZoneBoard', data);
    };
}