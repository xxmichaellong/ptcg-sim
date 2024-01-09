import { oppContainerDocument, selfContainerDocument, socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { buildDeck } from '../../setup/deck-constructor/build-deck.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { removeImages } from '../../setup/image-logic/remove-images.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { hideZoneElementsIfEmpty } from './close-popups.js';
import { updateCount } from './count.js';

export const reset = (user, clean = false, emit = true, build = true, invalidMessage = true) => {
    const stadium = getZone('neutral', 'stadium');
    systemState.turn = 0;
    if (stadium.array[0] && ((stadium.array[0].image.user === 'self' && user === 'self') || (stadium.array[0].image.user !== 'self' && user !== 'self'))){
        stadium.array.length = 0;
        document.querySelectorAll('.tab').forEach(element => {
            element.classList.remove('tab');
        });
        removeImages(stadium.element);
    };
    if (user === 'self'){
        selfContainerDocument.querySelectorAll('.self-circle, .opp-circle, .self-tab, .opp-tab').forEach(element => {
            element.textContent = '0'
            element.handleRemove(false);
        });
        selfContainerDocument.querySelectorAll('.used-special-move').forEach(element => {
            element.classList.remove('used-special-move');
        });
    } else {
        oppContainerDocument.querySelectorAll('.self-circle, .opp-circle, .self-tab, .opp-tab').forEach(element => {
            element.textContent = '0'
            element.handleRemove(false);
        });
        oppContainerDocument.querySelectorAll('.used-special-move').forEach(element => {
            element.classList.remove('used-special-move');
        });
    };

    const zoneIds = ['deck', 'lostZone', 'discard', 'prizes', 'active', 'bench', 'hand', 'attachedCards', 'viewCards', 'board'];
    zoneIds.forEach(zoneId => {
        const zone = getZone(user, zoneId);
        zone.array.length = 0;
        removeImages(zone.element);
        if (zone.elementCover){
            removeImages(zone.elementCover);
        };
    });

    hideZoneElementsIfEmpty();

    if (build){
        if (determineDeckData(user)){
            buildDeck(user);
        } else if (invalidMessage){
            appendMessage('', determineUsername(user) + ' has an invalid deck!', 'announcement', false);
        };
    };

    if (!clean && determineDeckData(user)){
        appendMessage(user, determineUsername(user) + ' reset', 'player', false);
    };    
    updateCount();

    if (systemState.isTwoPlayer && emit){
        user = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId: systemState.roomId,
            user: user,
            clean: clean,
            emit: false,
            build: build,
            invalidMessage: invalidMessage
        };
        socket.emit('reset', data);
    };
}