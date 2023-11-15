import { Card } from "../setup/card.js";
export function makeDeckCover(user){
  
    let cardAttributes = {
        name: 'Deck Cover',
        type: 'cover'
    };

    let imageAttributes = {
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

    if (user === 'opp'){
        imageAttributes = (({ src, alt, id }) => ({ src, alt, id }))(imageAttributes);
    };

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes);
}