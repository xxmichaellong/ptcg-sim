import { rearrangeArray } from "../setup/shuffle.js"
import { removeImages } from "../image-logic/remove-images.js";
import { socket } from "../setup/socket.js";
import { stringToVariable } from "../setup/string-to-variable.js";
import { shuffleIndices } from "../setup/shuffle.js";
import { roomId } from "../start-page/generate-id.js";

export function shuffleContainer(user, location, location_html, indices){
    location = stringToVariable(user, location);
    location_html = stringToVariable(user, location_html)
 
    removeImages(location_html);

    location.cards = rearrangeArray(location.cards, indices);

    for (let i = 0; i < location.count; i++){
        location_html.appendChild(location.cards[i].image);
    };
}

export function shuffleButtonFunction (user, location, location_html, indices){

    let _location = stringToVariable(user, location);
    if (user === 'self'){
        indices = shuffleIndices(_location.cards.length);
    };
    shuffleContainer(user, location, location_html, indices);
    
    if (user === 'self')
        socket.emit('shuffleButtonFunction', roomId, 'opp', location, location_html, indices);
}