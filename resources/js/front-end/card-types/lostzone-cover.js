import { Card } from "../setup/card.js";

export function makeLostzoneCover(user, src){

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
        draggable: false,
        click: 'lostzoneCoverClick'
    };

    /* if (user === 'opp'){
        imageAttributes = (({ src, alt, id, draggable, click }) => ({ src, alt, id, draggable, click }))(imageAttributes);
    }; */
    
    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return new Card(rawCardAttributes, rawImageAttributes);
}
