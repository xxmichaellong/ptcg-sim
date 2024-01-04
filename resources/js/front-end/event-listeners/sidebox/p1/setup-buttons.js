import { reset } from '../../../actions/general/reset.js';
import { setup } from '../../../actions/general/setup.js';
import { systemState, clearLog, exportLog, optionsButton, optionsContextMenu, p1Box, resetBothButton, resetButton, setupBothButton, setupButton } from '../../../front-end.js';
import { clearChatboxContent, exportChatboxContent } from '../../../setup/chatbox/export-chat.js';

setupButton.addEventListener('click', () => setup(systemState.pov.user));

setupBothButton.addEventListener('click', () => {
    setup('self');
    setup('opp');
});

resetButton.addEventListener('click', () => reset(systemState.pov.user));

resetBothButton.addEventListener('click', () => {
    reset('self');
    reset('opp');
});

optionsButton.addEventListener('click', () => {
    optionsContextMenu.style.display = 'block';
    const adjustment = p1Box.offsetHeight - optionsButton.offsetTop
    optionsContextMenu.style.bottom = `${adjustment}px`;
    document.addEventListener('mousedown', hideOptionsContextMenu);
});

clearLog.addEventListener('click', () => {
    clearChatboxContent();
    optionsContextMenu.style.display = 'none';
});

exportLog.addEventListener('click', () => {
    exportChatboxContent();
    optionsContextMenu.style.display = 'none';
});

export const hideOptionsContextMenu = (event) => {
    if (!optionsContextMenu.contains(event.target)) {
        optionsContextMenu.style.display = 'none';
        document.removeEventListener('mousedown', hideOptionsContextMenu);
    }
}