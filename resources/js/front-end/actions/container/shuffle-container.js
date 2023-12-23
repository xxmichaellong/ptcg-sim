import { rearrangeArray, shuffleIndices } from '../../setup/general/shuffle.js'
import { removeImages } from '../../image-logic/remove-images.js';
import { stringToVariable } from '../../setup/containers/string-to-variable.js';
import { p1, roomId, socket } from '../../front-end.js';
import { sort } from '../general/sort.js';

export const shuffleContainer = (user, location, location_html, indices, received = false) => {
    const _location = location;
    const _location_html = location_html;
    location = stringToVariable(user, location);
    location_html = stringToVariable(user, location_html);
    const shuffledIndices = indices ? indices : shuffleIndices(location.count);
    removeImages(location_html);
    location.cards = rearrangeArray(location.cards, shuffledIndices);
    for (let i = 0; i < location.count; i++){
        location_html.appendChild(location.cards[i].image);
    };
    if (!p1[0] && !received){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : roomId,
            user: oUser,
            location : _location,
            location_html: _location_html,
            indices: shuffledIndices,
            received: true
        };
        socket.emit('shuffleContainer', data);
    };
    sort(user);
}