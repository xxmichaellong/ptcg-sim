import { reset } from "../../../../actions/general/reset.js";
import { socket, systemState } from '../../../../front-end.js';
import { cleanActionData } from "../../../../setup/general/clean-action-data.js";
import { handleSpectatorButtons } from "../../../../setup/spectator/handle-spectator-buttons.js";
import { removeSyncIntervals } from "../../../socket-event-listeners/socket-event-listeners.js";

export const initializeRoomButtons = () => {
    const roomIdInput = document.getElementById('roomIdInput');

    const copyButton = document.getElementById('copyButton');
    copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(roomIdInput.value);

        copyButton.classList.add('copied');
        setTimeout(() => {
            copyButton.classList.remove('copied');
        }, 1000);
    });

    const roomHeaderCopyButton = document.getElementById('roomHeaderCopyButton');
    roomHeaderCopyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(roomIdInput.value).then(() => {
            roomHeaderCopyButton.classList.add('copied');
            setTimeout(() => {
                roomHeaderCopyButton.classList.remove('copied');
            }, 1000);
        });
    });

    const generateIdButton = document.getElementById('generateIdButton');
    generateIdButton.addEventListener('click', () => {
        roomIdInput.value = socket.id.toString() + '0';
    });

    const joinRoomButton = document.getElementById('joinRoomButton');
    joinRoomButton.addEventListener('click', () => {
        const nameInput = document.getElementById('nameInput');
        const names = ['Froakie', 'Shauna', 'Avery', 'Peonia', 'Korrina', 'Guzma', 'Bridgette', 'AZ', 'Xerosic', 'Colress', 'Melony', 'Serena', 'Thorton', 'Cyllene', 'Acerola', 'Marnie', 'Arven', 'Giovanni', 'Judge', 'Boss', 'Penny', 'Leon', 'Cheren', 'Elesa', 'Volo', 'Raihan', 'Ash', 'Brock', 'Misty', 'Cynthia', 'Oak', 'N', 'Roxanne', 'Iono', 'Irida', 'Lysandre', 'Cyrus', 'Hex', 'Skyla', 'Juniper', 'Sycamore'];
        const randomIndex = Math.floor(Math.random() * names.length);
        systemState.p2SelfUsername = nameInput.value.trim() !== '' ? nameInput.value : names[randomIndex];
        systemState.roomId = roomIdInput.value;
        socket.emit('joinGame', systemState.roomId, systemState.p2SelfUsername, document.getElementById('spectatorModeCheckbox').checked);
    });
    
    const leaveRoomButton = document.getElementById('leaveRoomButton');
    leaveRoomButton.addEventListener('click', () => {
        if (window.confirm('Are you sure you want to leave the room? Battle log will be erased.')) {
            const isSpectator = systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked;
            const username = isSpectator ? systemState.spectatorUsername : systemState.p2SelfUsername;
            const data = {
                roomId: systemState.roomId,
                username: username,
                isSpectator: document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer
            };
            socket.emit('leaveRoom', data);
            const connectedRoom = document.getElementById('connectedRoom');
            const lobby = document.getElementById('lobby');
            const p2ExplanationBox = document.getElementById('p2ExplanationBox');
            const p2Chatbox = document.getElementById('p2Chatbox');
            lobby.style.display = 'block';
            p2ExplanationBox.style.display = 'block';
            document.getElementById('flipBoardButton').style.display = 'inline-block';
            connectedRoom.style.display = 'none';
            systemState.isTwoPlayer = false;
            systemState.roomId = '';
            cleanActionData('self');
            cleanActionData('opp');
            reset('opp', true, true, false, true);

            //repopulate self deck with the correct current decklist
            systemState.selfDeckData = '';
            let decklistTable = document.getElementById('selfCurrentDecklistTable');
            if (decklistTable){
                let rows = decklistTable.rows;
                let deckData = [];
                for (let i = 1; i < rows.length; i++) {
                    let cells = rows[i].cells;
                    
                    let quantity = cells[0].innerText;
                    let name = cells[1].innerText;
                    let type = cells[2].innerText;
                    let url = cells[3].innerText;
            
                    let cardData = [quantity, name, type, url];
                    deckData.push(cardData);
                };
                if (deckData.length > 0){
                    systemState.selfDeckData = deckData;
                };
            };

            reset('self', true, true, false, true);
            p2Chatbox.innerHTML = '';
            systemState.coachingMode = false;
            handleSpectatorButtons();
            removeSyncIntervals();
            systemState.spectatorId = '';
        };
    });
};