import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { getZone } from "../../setup/zones/get-zone.js";
import { moveCard } from "../move-card-logic/move-card.js";
import { shuffleZone } from "../zones/shuffle-zone.js";

export const discardBoard = (user, message = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'board', 'discard', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + selectedBoardCount + ' card(s) from board to discard', 'player')
        };
    };
}

export const handBoard = (user, message = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'board', 'hand', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + selectedBoardCount + ' card(s) from board to hand', 'player')
        };
    };
}

export const shuffleBoard = (user, message = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'board', 'deck', 0);
        };
        shuffleZone(user, 'deck');
        if (message){
            appendMessage(user, determineUsername(user) + ' shuffled ' + selectedBoardCount + ' card(s) from board to deck', 'player')
        };
    };
}

export const lostZoneBoard = (user, message = true) => {
    const selectedBoardCount = getZone(user, 'board').getCount();
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'board', 'lostZone', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + selectedBoardCount + ' card(s) from board to lost zone', 'player')
        };
    };
}