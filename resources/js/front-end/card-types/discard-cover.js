import { Card } from "../setup/card.js";

export function makeDiscardCover(src){
    const cardAttributes = {
        name: 'Discard Cover',
        type: 'cover'
    };

    const imageAttributes = {
        src: src,
        alt: 'Discard Cover',
        id: 'discardDisplay_html',
        dragover: 'dragOver',
        drop: 'drop',
        draggable: false,
        click: 'discardCoverClick'
    };

    const oppImageAttributes = (({ src, alt, id }) => ({ src, alt, id }))(imageAttributes);

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);
    const oppRawImageAttributes = JSON.stringify(oppImageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes, oppRawImageAttributes);
}