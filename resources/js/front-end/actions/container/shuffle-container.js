import { rearrangeArray } from '../../setup/general/shuffle.js'
import { removeImages } from '../../image-logic/remove-images.js';
import { stringToVariable } from '../../setup/containers/string-to-variable.js';

export const shuffleContainer = (user, location, location_html, indices) => {
    location = stringToVariable(user, location);
    location_html = stringToVariable(user, location_html)
 
    removeImages(location_html);

    location.cards = rearrangeArray(location.cards, indices);

    for (let i = 0; i < location.count; i++){
        location_html.appendChild(location.cards[i].image);
    };
}