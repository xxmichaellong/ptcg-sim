import { shuffle } from "./shuffle.js"
import { removeImages } from "./removeImages.js";
import { containerToLocation } from "./containerReference.js";

export function shufflePopupButton() {
    var popup = document.getElementById('shufflePopup');
    popup.style.display = 'block';
}

export function shuffleContainer(container_html) {
    removeImages(document.getElementById(container_html));

    const container = containerToLocation[container_html];
    
    shuffle(container.cards, container.images);

    for (let i=0; i<container.count; i++){
        document.getElementById(container_html).appendChild(container.images[i]);
    }
    shufflePopup.style.display = "none";
}