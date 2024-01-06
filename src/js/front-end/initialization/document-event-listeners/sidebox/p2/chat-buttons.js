import { resetCounters } from "../../../../actions/counters/reset-ability-counters.js";
import { discardBoard } from "../../../../actions/general/board-actions.js";
import { systemState } from "../../../../front-end.js";
import { appendMessage } from "../../../../setup/chatbox/messages.js";
import { determineUsername } from "../../../../setup/general/determine-username.js";

export const initializeP2ChatButtons = () => {
    const p2AttackButton = document.getElementById('p2AttackButton');
    p2AttackButton.addEventListener('click', () => {
        resetCounters();
        const user = systemState.pov.user;
        const message = determineUsername(user) + ' attacked';
        appendMessage(user, message, 'player');
        discardBoard(user, false);
    });

    const p2PassButton = document.getElementById('p2PassButton');
    p2PassButton.addEventListener('click', () => {
        resetCounters();
        const user = systemState.pov.user;
        const message = determineUsername(user) + ' passed';
        appendMessage(user, message, 'player');
        discardBoard(user, false);
    });

    const p2MessageInput = document.getElementById('p2MessageInput');
    p2MessageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const message = p2MessageInput.value.trim();
            if (message !== '') {
                appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ': ' + message, 'message');
                p2MessageInput.value = '';
            }
        }
    });

    const p2FREEBUTTON = document.getElementById('p2FREEBUTTON');
    p2FREEBUTTON.addEventListener('click', () => {
        appendMessage(systemState.pov.user, p2FREEBUTTON.textContent, 'player');
    });
};