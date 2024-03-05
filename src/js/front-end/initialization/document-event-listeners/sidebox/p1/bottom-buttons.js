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