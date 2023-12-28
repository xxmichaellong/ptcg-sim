import { hand_html, oppHand_html } from '../../front-end.js';
import { adjustAlignment } from '../../setup/sizing/adjust-alignment.js';
import { reloadBoard } from '../../setup/sizing/reload-board.js';

window.addEventListener('resize', () => {
    [hand_html, oppHand_html].forEach(adjustAlignment);
    reloadBoard();
});