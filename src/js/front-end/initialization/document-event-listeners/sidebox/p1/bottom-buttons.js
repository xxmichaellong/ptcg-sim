import { reset } from '../../../../actions/general/reset.js';
import { setup } from '../../../../actions/general/setup.js';
import { socket, systemState } from '../../../../front-end.js';
import { clearChatboxContent, exportChatboxContent } from '../../../../setup/chatbox/export-chat.js';
import { hideOptionsContextMenu } from '../../../../setup/chatbox/hide-options-context-menu.js';
import { acceptAction } from '../../../../setup/general/accept-action.js';
import { cleanActionData } from '../../../../setup/general/clean-action-data.js';
import { refreshBoardImages } from '../../../../setup/sizing/refresh-board.js';

export const initializeP1BottomButtons = () => {
    const setupButton = document.getElementById('setupButton');
    const setupFunction = () => setup(systemState.initiator)
    setupButton.addEventListener('click', setupFunction);

    const setupBothButton = document.getElementById('setupBothButton');
    const setupBothFunction = () => {
        setup('self');
        setup('opp');
    }
    setupBothButton.addEventListener('click', setupBothFunction);

    const resetButton = document.getElementById('resetButton');
    const resetFunction = () => reset(systemState.initiator)
    resetButton.addEventListener('click', resetFunction);

    const resetBothButton = document.getElementById('resetBothButton');
    const resetBothFunction = () => {
        reset('self');
        reset('opp');
    }
    resetBothButton.addEventListener('click', resetBothFunction);

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
        systemState.isReplay = false; // for good measure
        fileInput.click();
    });
    fileInput.addEventListener('change', handleFileSelect);
    
    const fileReplay = document.getElementById('jsonReplay');
    const importReplay = document.getElementById('importReplay');
    importReplay.addEventListener('click', (event) => {
        event.preventDefault();
        systemState.isReplay = true;
        fileReplay.click();
    });
    fileReplay.addEventListener('change', handleFileSelect);
    
    const exitReplay = document.getElementById('exitReplay');
    exitReplay.addEventListener('click', () => {
        exitReplayMode();
        optionsContextMenu.style.display = 'none';
    });
    
    const replayNextFunction = () => {
        if (systemState.replayActionData.length == 0){
            return;
        }
        const data = systemState.replayActionData[0];
        acceptAction(data.user, data.action, data.parameters, true,true);
        systemState.replayActionData.shift();
    }
    
    const replayPrevFunction = () => {
        if (systemState.exportActionData.length == 0){
            return;
        }
        const lastAction = systemState.exportActionData.pop();
        systemState.replayActionData.unshift(lastAction);
        const actions = structuredClone(systemState.exportActionData);
        resetBothFunction();
        systemState.exportActionData = [];
        clearChatboxContent();
        actions.forEach(data => {
            acceptAction(data.user, data.action, data.parameters, true, true);
        });
    }
    
    const replayFFFunction = () => {
        while (systemState.replayActionData.length > 0){
            replayNextFunction();
        }
    }
    
    const replayRewFunction = () => {
        while (systemState.exportActionData.length > 0){
            systemState.replayActionData.unshift(systemState.exportActionData.pop());
        }
        resetBothFunction();
        systemState.exportActionData = [];
        clearChatboxContent();
    }
    
    function enterReplayMode() {
        clearChatboxContent();
        
        document.getElementById("chatboxButtonContainer").style.display='none';
        document.getElementById("messageInput").style.display='none';
        exitReplay.style.display='block';
        document.getElementById("jsonReplayDiv").style.display='none';
        document.getElementById("jsonDiv").style.display='none';
        exportState.style.display='block';
        exportLog.style.display='block';
        clearLog.style.display='none';
        document.getElementById("turnButton").style.display='none';
        document.getElementById("flipCoinButton").style.display='none';
        
        setupButton.removeEventListener('click', setupFunction);
        setupBothButton.removeEventListener('click', setupBothFunction);
        resetButton.removeEventListener('click', resetFunction);
        resetBothButton.removeEventListener('click', resetBothFunction);
        
        setupButton.addEventListener('click', replayNextFunction);
        setupBothButton.addEventListener('click', replayFFFunction);
        resetButton.addEventListener('click', replayPrevFunction);
        resetBothButton.addEventListener('click', replayRewFunction);
        
        setupButton.innerHTML = "Next";
        setupBothButton.innerHTML = "Fast Forward";
        resetButton.innerHTML = "Prev";
        resetBothButton.innerHTML = "Rewind";
        
        optionsContextMenu.style.display = 'none'; // for good measure
    }
    
    function exitReplayMode() {
        exitReplay.style.display='none';
        document.getElementById("chatboxButtonContainer").style.display='flex';
        document.getElementById("messageInput").style.display='inline-block'; document.getElementById("jsonReplayDiv").style.display='block';
        document.getElementById("jsonDiv").style.display='block';
        exportState.style.display='block';
        exportLog.style.display='block';
        clearLog.style.display='block';
        document.getElementById("turnButton").style.display='block';
        document.getElementById("flipCoinButton").style.display='block';
        
        setupButton.addEventListener('click', setupFunction);
        setupBothButton.addEventListener('click', setupBothFunction);
        resetButton.addEventListener('click', resetFunction);
        resetBothButton.addEventListener('click', resetBothFunction);
        
        setupButton.removeEventListener('click', replayNextFunction);
        setupBothButton.removeEventListener('click', replayFFFunction);
        resetButton.removeEventListener('click', replayPrevFunction);
        resetBothButton.removeEventListener('click', replayRewFunction);
        
        setupButton.innerHTML = "Set Up";
        setupBothButton.innerHTML = "Set Up Both";
        resetButton.innerHTML = "Reset";
        resetBothButton.innerHTML = "Reset Both";
        
        systemState.isReplay = false;
        optionsContextMenu.style.display = 'none';
    }

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
                const actions = jsonData;
                if (systemState.isTwoPlayer || !systemState.isReplay) {
                    actions.forEach(data => {
                        acceptAction(data.user, data.action, data.parameters, true);
                    });
                    socket.emit('resetCounter', {roomId: systemState.roomId});
                }
                else{
                    console.assert(actions[0].action==="loadDeckData");
                    console.assert(actions[1].action==="loadDeckData");
                    acceptAction(actions[0].user, actions[0].action, actions[0].parameters, true, true);
                    acceptAction(actions[1].user, actions[1].action, actions[1].parameters, true, true);
                    actions.shift();
                    actions.shift();
                    systemState.replayActionData = structuredClone(actions);
                    enterReplayMode();
                }
            } catch (error) {
                console.error('Error reading file:', error);
                alert('Error reading file. Please make sure the file is valid.');
                systemState.isReplay = false;
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