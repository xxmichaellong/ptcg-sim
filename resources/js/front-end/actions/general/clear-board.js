import { board, oppBoard } from "../../front-end.js";
import { appendMessage } from "../../setup/chatbox/messages.js";
import { determineUsername } from "../../setup/general/determine-username.js";
import { moveCard } from "./move-card.js"

export const clearBoard = (user, message = true) => {
    const boardCount = user === 'self' ? board.count : oppBoard.count;
    if (boardCount > 0){
        for (let i = 0; i < boardCount; i++){
            moveCard(user, 'board', 'board_html', 'discard', 'discard_html', 0);
        };
        if (message){
            appendMessage(user, determineUsername(user) + ' moved card(s) from board to discard', 'player')
        };
    };
}