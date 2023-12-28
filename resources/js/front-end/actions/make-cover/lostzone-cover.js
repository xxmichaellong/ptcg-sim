import { Card } from '../../setup/deck-constructor/card.js';

export const makeLostzoneCover = (user, src) => {

    let cardAttributes = {
        name: 'Lost Zone Cover',
        type: 'cover'
    };

    let imageAttributes = {
        src: src,
        alt: 'Lost Zone Cover',
        id: 'lostzoneDisplay_html',
        dragover: 'dragOver',
        dragleave: 'dragLeave',
        drop: 'drop',
        click: 'lostzoneCoverClick',
        draggable: true,
        dragstart: 'dragStart',
        dragend: 'dragEnd',
        user: user
    };
    
    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes);
}
