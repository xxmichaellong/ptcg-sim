import { reset } from '../../../../actions/general/reset.js';
import { setup } from '../../../../actions/general/setup.js';
import { systemState } from '../../../../front-end.js';
import { clearChatboxContent, exportChatboxContent } from '../../../../setup/chatbox/export-chat.js';
import { hideOptionsContextMenu } from '../../../../setup/chatbox/hide-options-context-menu.js';

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

    const importState = document.getElementById('importState');
    importState.addEventListener('click', (event) => {
        event.preventDefault();
        alert("Coming soon!");
        // const file = event.target.files[0]; // Get the selected file
        // const reader = new FileReader(); // Create a new FileReader object
    
        // // Define the callback function to handle the file reading
        // reader.onload = function(event) {
        //     const content = event.target.result; // Get the content of the file
        //     console.log('ari')
        //     try {
        //         const data = JSON.parse(content); // Parse the JSON content
        //         // Now you have access to the unpackaged JSON data in the 'data' variable
        //         console.log(data);
        //         // You can perform further processing with the unpackaged data here
        //     } catch (error) {
        //         console.error('Error parsing JSON file:', error);
        //     }
        // };
        // // Read the selected file as text
        // reader.readAsText(file);
    });

    const exportState = document.getElementById('exportState');
    exportState.addEventListener('click', () => {
        alert("Coming soon!");
        // const jsonData = JSON.stringify(systemState.spectatorActionData, null, 2); // The null and 2 parameters are for pretty-printing
        // const blob = new Blob([jsonData], { type: 'application/json' });
        // const link = document.createElement('a');
        // link.href = window.URL.createObjectURL(blob);
        // link.download = 'data.json';
        // link.click();
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