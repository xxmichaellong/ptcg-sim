import { shuffle } from "../setup/shuffle.js"
import { removeImages } from "../image-logic/remove-images.js";
import { containerToLocation } from "../setup/container-reference.js";
import { mainContainersDocument } from "../setup/initialization.js";

export function shufflePopupButton() {
    var popup = document.getElementById('shufflePopup');
    popup.style.display = 'block';
}

export function shuffleContainer(container_html) {
    removeImages(mainContainersDocument.getElementById(container_html));

    const container = containerToLocation[container_html];
    
    shuffle(container.cards, container.images);

    for (let i=0; i<container.count; i++){
        mainContainersDocument.getElementById(container_html).appendChild(container.images[i]);
    }
    shufflePopup.style.display = "none";
}