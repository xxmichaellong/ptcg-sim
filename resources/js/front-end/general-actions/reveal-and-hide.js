import { removeImages } from "../image-logic/remove-images.js";

export function triggerRevealAndHidePopup(){
    const popup = document.getElementById('revealAndHidePopup');
    popup.style.display = 'block';
}

let rootDirectory = window.location.origin;

export function hideCard(card){
    //only trigger if card isn't already hidden
    if (card.image.src !== rootDirectory + '/resources/card-scans/cardback.png'){
    //store actual source in src2
        card.image.src2 = card.image.src;
        card.image.src = '/resources/card-scans/cardback.png';
    };
}

export function revealCard(card){
    //only trigger if card is hidden
    if (card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
        card.image.src = card.image.src2;
    };
}

export function hideCards(container, container_html){
    removeImages(container_html);
    container.cards.forEach(card => {
        hideCard(card);
        container_html.appendChild(card.image);
    });
}
export function revealCards(container, container_html){
    removeImages(container_html);
    container.cards.forEach(card => {
        revealCard(card);
        container_html.appendChild(card.image);
    });
}