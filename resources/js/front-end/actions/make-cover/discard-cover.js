import { Card } from '../../setup/deck-constructor/card.js';

export const makeDiscardCover = (user, src) => {
    
    let cardAttributes = {
        name: 'Discard Cover',
        type: 'cover'
    };

    let imageAttributes = {
        src: src,
        alt: 'Discard Cover',
        id: 'discardDisplay_html',
        dragover: 'dragOver',
        dragleave: 'dragLeave',
        drop: 'drop',
        draggable: false,
        click: 'discardCoverClick',
        user: user
    };

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes);
}