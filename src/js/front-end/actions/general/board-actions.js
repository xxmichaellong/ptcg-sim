import { boardArray, oppBoardArray } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { shuffleZone } from "../zones/shuffle-zone.js";
import { getZoneCount } from "./count.js";
import { moveCard } from "../move-card-logic/move-card.js"

export const discardBoard = (user, message = true) => {
    const selectedBoardCount = user === 'self' ? getZoneCount(boardArray) : getZoneCount(oppBoardArray);
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'boardArray', 'boardElement', 'discardArray', 'discardElement', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + selectedBoardCount + ' card(s) from board to discard', 'player')
        };
    };
}

export const handBoard = (user, message = true) => {
    const selectedBoardCount = user === 'self' ? getZoneCount(boardArray) : getZoneCount(oppBoardArray);
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'boardArray', 'boardElement', 'handArray', 'handElement', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + selectedBoardCount + ' card(s) from board to hand', 'player')
        };
    };
}

export const shuffleBoard = (user, message = true) => {
    const selectedBoardCount = user === 'self' ? getZoneCount(boardArray) : getZoneCount(oppBoardArray);
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'boardArray', 'boardElement', 'deckArray', 'deckElement', 0);
        };
        shuffleZone(user, 'deckArray', 'deckElement');
        if (message){
            appendMessage(user, determineUsername(user) + ' shuffled ' + selectedBoardCount + ' card(s) from board to deck', 'player')
        };
    };
}

export const lostZoneBoard = (user, message = true) => {
    const selectedBoardCount = user === 'self' ? getZoneCount(boardArray) : getZoneCount(oppBoardArray);
    if (selectedBoardCount > 0){
        for (let i = 0; i < selectedBoardCount; i++){
            moveCard(user, 'boardArray', 'boardElement', 'lostZoneArray', 'lostZoneElement', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + selectedBoardCount + ' card(s) from board to lost zone', 'player')
        };
    };
}