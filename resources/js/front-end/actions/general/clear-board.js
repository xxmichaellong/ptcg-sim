import { board, oppBoard } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { shuffleContainer } from "../container/shuffle-container.js";
import { moveCard } from "./move-card.js"

export const discardBoard = (user, message = true) => {
    const boardCount = user === 'self' ? board.count : oppBoard.count;
    if (boardCount > 0){
        for (let i = 0; i < boardCount; i++){
            moveCard(user, 'board', 'board_html', 'discard', 'discard_html', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + boardCount + ' card(s) from board to discard', 'player')
        };
    };
}

export const handBoard = (user, message = true) => {
    const boardCount = user === 'self' ? board.count : oppBoard.count;
    if (boardCount > 0){
        for (let i = 0; i < boardCount; i++){
            moveCard(user, 'board', 'board_html', 'hand', 'hand_html', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + boardCount + ' card(s) from board to hand', 'player')
        };
    };
}

export const shuffleBoard = (user, message = true) => {
    const boardCount = user === 'self' ? board.count : oppBoard.count;
    if (boardCount > 0){
        for (let i = 0; i < boardCount; i++){
            moveCard(user, 'board', 'board_html', 'deck', 'deck_html', 0);
        };
        shuffleContainer(user, 'deck', 'deck_html');
        if (message){
            appendMessage(user, determineUsername(user) + ' shuffled ' + boardCount + ' card(s) from board to deck', 'player')
        };
    };
}

export const lostzoneBoard = (user, message = true) => {
    const boardCount = user === 'self' ? board.count : oppBoard.count;
    if (boardCount > 0){
        for (let i = 0; i < boardCount; i++){
            moveCard(user, 'board', 'board_html', 'lostzone', 'lostzone_html', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved ' + boardCount + ' card(s) from board to lost zone', 'player')
        };
    };
}