import { deckImport, p1Box, p2Box, settings } from '../../front-end.js';

export const show = (id) => {
    deckImport.style.display = 'none';
    settings.style.display = 'none';
    p1Box.style.display = 'none';
    p2Box.style.display = 'none';
    document.getElementById(id).style.display = 'flex';
}