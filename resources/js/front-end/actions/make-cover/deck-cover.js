import { Card } from '../../setup/deck-constructor/card.js';

export const makeDeckCover = (user) => {
  
    let cardAttributes = {
        name: 'Deck Cover',
        type: 'cover'
    };

    let imageAttributes = {
        src: '../resources/card-scans/cardback.png',
        alt: 'Deck Cover',
        id: 'deckDisplay_html',
        dragover: 'dragOver',
        dragleave: 'dragLeave',
        drop: 'drop',
        click: 'deckCoverClick',
        draggable: true,
        dragstart: 'dragStart',
        dragend: 'dragEnd',
        user: user,
        contextmenu: 'openCardContextMenu'
    };

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes);
}