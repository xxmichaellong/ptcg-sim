import { attack, pass } from "../../../../actions/chat-buttons/chat-buttons.js";
import { undo } from "../../../../actions/general/undo.js";
import { socket, systemState } from "../../../../front-end.js";
import { appendMessage } from "../../../../setup/chatbox/append-message.js";
import { determineUsername } from "../../../../setup/general/determine-username.js";

export const initializeP2ChatButtons = () => {
    const p2AttackButton = document.getElementById('p2AttackButton');
    p2AttackButton.addEventListener('click', () => attack(systemState.initiator));

    const p2PassButton = document.getElementById('p2PassButton');
    p2PassButton.addEventListener('click', () => pass(systemState.initiator));

    const p2MessageInput = document.getElementById('p2MessageInput');
    p2MessageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const message = p2MessageInput.value.trim();
            if (message !== '') {
                const isSpectator = systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked;
                const type = isSpectator ? 'spectator-message' : 'player';
                const username = isSpectator ? systemState.spectatorUsername : determineUsername(systemState.initiator);
                appendMessage(systemState.initiator,  username + ': ' + message, type);
                p2MessageInput.value = '';
            };
        };
    });

    const p2UndoButton = document.getElementById('p2UndoButton');
    p2UndoButton.addEventListener('click', () => {
        p2UndoButton.textContent = "Loading...";
        setTimeout(()=>{
            undo(systemState.initiator);
        }, 1);
    });

    const p2FREEBUTTON = document.getElementById('p2FREEBUTTON');
    p2FREEBUTTON.addEventListener('click', () => {
        const isSpectator = systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked;
        const type = isSpectator ? 'spectator-message' : 'player';
        appendMessage(systemState.initiator, p2FREEBUTTON.textContent, type);

        // const disconnectAndReconnect = (socket, delay) => {
        //     // Disconnect the socket
        //     socket.disconnect();
        //     // Reconnect after 'delay' milliseconds
        //     setTimeout(() => {
        //         socket.connect();
        //     }, delay);
        // }
        //     // Assuming 'socket' is your Socket.IO socket and you want to wait 5 seconds (5000 milliseconds)
        //     disconnectAndReconnect(socket, 10000);
    });
};