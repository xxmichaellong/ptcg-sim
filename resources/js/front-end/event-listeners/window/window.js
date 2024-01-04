import { handElement, oppHandElement } from '../../front-end.js';
import { adjustAlignment } from '../../setup/sizing/adjust-alignment.js';
import { reloadBoard } from '../../setup/sizing/reload-board.js';

window.addEventListener('resize', () => {
    [handElement, oppHandElement].forEach(adjustAlignment);
    reloadBoard();
});