import { oppContainerDocument, selfContainerDocument } from '../../../front-end.js';
import { adjustAlignment } from '../../../setup/sizing/adjust-alignment.js';
import { refreshBoard } from '../../../setup/sizing/refresh-board.js';

export const initializeWindow = () => {
    window.addEventListener('resize', () => {
        const handElement = selfContainerDocument.getElementById('hand');
        const oppHandElement = oppContainerDocument.getElementById('hand');
        [handElement, oppHandElement].forEach(adjustAlignment);
        refreshBoard();
    });
}