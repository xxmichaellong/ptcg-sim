import { Card } from "../setup/card.js";
export function makeDeckCover(){
    const cardAttributes = {
        name: 'Deck Cover',
        type: 'cover'
    };

    const imageAttributes = {
        src: 'resources/card-scans/cardback.png',
        alt: 'Deck Cover',
        id: 'deckDisplay_html',
        dragover: 'dragOver',
        drop: 'drop',
        click: 'deckCoverClick',
        draggable: true,
        dragstart: 'dragStart',
        dragend: 'dragEnd'
    };

    const oppImageAttributes = (({ src, alt, id }) => ({ src, alt, id }))(imageAttributes);

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);
    const oppRawImageAttributes = JSON.stringify(oppImageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes, oppRawImageAttributes);
}