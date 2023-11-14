import { removeImages } from "../image-logic/remove-images.js";

export function triggerRevealAndHidePopup(){
    const popup = document.getElementById('revealAndHidePopup');
    popup.style.display = 'block';
}

export function hideCard(card){
    card.image.src2 = card.image.src;
    card.image.src = 'resources/card-scans/cardback.png';
}

export function revealCard(card){
    card.image.src = card.image.src2;
}

export function hideCards(container, container_html){
    removeImages(container_html);
    container.cards.forEach(card => {
        hideCard(card);
        container_html.appendChild(card.image);
    });
    revealAndHidePopup.style.display = "none";
}
export function revealCards(container, container_html){
    removeImages(container_html);
    container.cards.forEach(card => {
        revealCard(card);
        container_html.appendChild(card.image);
    });
    revealAndHidePopup.style.display = "none";
}