import { deckImport, deckImportButton, p1Box, p1Button, p2Box, p2Button, settings, settingsButton } from '../../front-end.js';

export const show = (id, button) => {
    deckImport.style.display = 'none';
    settings.style.display = 'none';
    p1Box.style.display = 'none';
    p2Box.style.display = 'none';
    const page = document.getElementById(id);
    page.style.display = 'flex';

    const buttons = [p1Button, p2Button, settingsButton, deckImportButton];

    buttons.forEach(btn => {
        btn.classList.remove('selectedPage');
        btn.classList.add('notSelectedPage');
    });
    
    button.classList.remove('notSelectedPage');
    button.classList.add('selectedPage');    
}