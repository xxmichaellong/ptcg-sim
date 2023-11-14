import { Card } from "../setup/card.js";

export function makeLostzoneCover(src){
    const cardAttributes = {
        name: 'Lost Zone Cover',
        type: 'cover'
    };

    const imageAttributes = {
        src: src,
        alt: 'Lost Zone Cover',
        id: 'lostzoneDisplay_html',
        dragover: 'dragOver',
        drop: 'drop',
        draggable: false,
        click: 'lostzoneCoverClick'
    };

    const oppImageAttributes = (({ src, alt, id }) => ({ src, alt, id }))(imageAttributes);

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);
    const oppRawImageAttributes = JSON.stringify(oppImageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes, oppRawImageAttributes);
}
