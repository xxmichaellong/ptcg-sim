import { removeImages } from '../../image-logic/remove-images.js';
import { stringToVariable } from '../../setup/containers/string-to-variable.js';

let rootDirectory = window.location.origin;

export const hideCard = (card) => {
    //only trigger if card isn't already hidden
    if (card.image.src !== rootDirectory + '/resources/card-scans/cardback.png'){
    //store actual source in src2
        card.image.src2 = card.image.src;
        card.image.src = '/resources/card-scans/cardback.png';
    };
}

export const revealCard = (card) => {
    //only trigger if card is hidden
    if (card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        card.image.src = card.image.src2;
    };
}

export const hideCards = (user, container, container_html) => {
    container = stringToVariable(user, container);
    container_html = stringToVariable(user, container_html);
    removeImages(container_html);
    container.cards.forEach(card => {
        hideCard(card);
        container_html.appendChild(card.image);
    });
}
export const revealCards = (user, container, container_html) => {
    container = stringToVariable(user, container);
    container_html = stringToVariable(user, container);
    removeImages(container_html);
    container.cards.forEach(card => {
        revealCard(card);
        container_html.appendChild(card.image);
    });
}