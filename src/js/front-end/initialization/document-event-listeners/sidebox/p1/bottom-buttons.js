import { reset } from '../../../../actions/general/reset.js';
import { setup } from '../../../../actions/general/setup.js';
import { socket, systemState, version } from '../../../../front-end.js';
import { clearChatboxContent, exportChatboxContent } from '../../../../setup/chatbox/export-chat.js';
import { hideOptionsContextMenu } from '../../../../setup/chatbox/hide-options-context-menu.js';
import { acceptAction } from '../../../../setup/general/accept-action.js';
import { cleanActionData } from '../../../../setup/general/clean-action-data.js';
import { refreshBoardImages } from '../../../../setup/sizing/refresh-board.js';

export const initializeP1BottomButtons = () => {
    const setupButton = document.getElementById('setupButton');
    setupButton.addEventListener('click', () => setup(systemState.initiator));

    const setupBothButton = document.getElementById('setupBothButton');
    setupBothButton.addEventListener('click', () => {
        setup('self');
        setup('opp');
    });

    const resetButton = document.getElementById('resetButton');
    resetButton.addEventListener('click', () => reset(systemState.initiator));

    const resetBothButton = document.getElementById('resetBothButton');
    resetBothButton.addEventListener('click', () => {
        reset('self');
        reset('opp');
    });

    const optionsContextMenu = document.getElementById('optionsContextMenu');

    const optionsButton = document.getElementById('optionsButton');
    optionsButton.addEventListener('click', () => {
        const p1Box = document.getElementById('p1Box');
        optionsContextMenu.style.display = 'block';
        const adjustment = p1Box.offsetHeight - optionsButton.offsetTop;
        optionsContextMenu.style.bottom = `${adjustment}px`;
        document.addEventListener('mousedown', hideOptionsContextMenu);
    });

    const clearLog = document.getElementById('clearLog');
    clearLog.addEventListener('click', () => {
        clearChatboxContent();
        optionsContextMenu.style.display = 'none';
    });

    const exportLog = document.getElementById('exportLog');
    exportLog.addEventListener('click', () => {
        exportChatboxContent();
        optionsContextMenu.style.display = 'none';
    });

    const fileInput = document.getElementById('jsonFile');
    const importState = document.getElementById('importState');
    importState.addEventListener('click', (event) => {
        event.preventDefault();
        fileInput.click();
    });
    fileInput.addEventListener('change', handleFileSelect);

    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                socket.emit('initiateImport', {roomId: systemState.roomId});
                cleanActionData('self');
                cleanActionData('opp');
                const jsonData = JSON.parse(e.target.result);
                const actions = jsonData.slice(1); // first element is the version #
                actions.forEach(data => {
                    acceptAction(data.user, data.action, data.parameters, true);
                });
                socket.emit('resetCounter', {roomId: systemState.roomId});
            } catch (error) {
                console.error('Error reading file:', error);
                alert('Error reading file. Please make sure the file is valid.');
            } finally {
                refreshBoardImages();
                socket.emit('endImport', {roomId: systemState.roomId});
                fileInput.value = '';
                optionsContextMenu.style.display = 'none';
            }
        };
        reader.readAsText(file);
    }

    const exportState = document.getElementById('exportState');

    // Function to handle the user's choice
    function handleUserChoice(choice, jsonData) {
        if (choice === '2') {
            socket.emit('storeGameState', jsonData);
        } else if (choice === '1') {
            const blob = new Blob([jsonData], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = window.URL.createObjectURL(blob);
            link.download = 'data.json';
            link.click();
        }
        // Hide the options menu after handling the choice
        optionsContextMenu.style.display = 'none';
    }

    exportState.addEventListener('click', () => {
        const selfData = {
            user: 'self',
            emit: true,
            action: 'loadDeckData',
            parameters: [systemState.selfDeckData],
        }
        const oppData = {
            user: 'opp',
            emit: true,
            action: 'loadDeckData',
            parameters: [systemState.isTwoPlayer ? systemState.p2OppDeckData : systemState.p1OppDeckData],
        }
        systemState.exportActionData.unshift(selfData, oppData);
        systemState.exportActionData.unshift({version: version})

        const jsonData = JSON.stringify(systemState.exportActionData, null, 2);

        const userChoice = prompt("Enter '1' to save a file or enter '2' to generate a URL");
        if (userChoice === '1' || userChoice === '2') {
            handleUserChoice(userChoice, jsonData);
        }
    });

    const fullscreenButton = document.getElementById('fullscreenButton');

    fullscreenButton.addEventListener('click', function () {
        const element = document.documentElement;
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
        } else if (element.webkitRequestFullScreen) {
            element.webkitRequestFullScreen();
        } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
        }
        optionsContextMenu.style.display = 'none';
    });
}