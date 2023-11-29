import { Card } from "../setup/card.js";

export function makeDiscardCover(user, src){
    
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
        click: 'discardCoverClick'
    };

    /* if (user === 'opp'){
        imageAttributes = (({ src, alt, id, draggable, click }) => ({ src, alt, id, draggable, click }))(imageAttributes);
    }; */

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes);
}