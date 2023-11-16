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
        dragend: 'dragEnd',
        user: user
    };

    if (user === 'opp'){
        imageAttributes = (({ src, alt, id, user }) => ({ src, alt, id, user }))(imageAttributes);
    };

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes);
}