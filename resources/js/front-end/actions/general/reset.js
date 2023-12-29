import { active, active_html, attachedCardPopup, attachedCardPopup_html, bench, bench_html, board, board_html, deck, deckDisplay_html, deck_html, discard, discardDisplay_html, discard_html, hand, hand_html, lostzone, lostzoneDisplay_html, lostzone_html, oppActive, oppActive_html, oppAttachedCardPopup, oppAttachedCardPopup_html, oppBench, oppBench_html, oppBoard, oppBoard_html, oppContainersDocument, oppDeck, oppDeckDisplay_html, oppDeck_html, oppDiscard, oppDiscardDisplay_html, oppDiscard_html, oppHand, oppHand_html, oppLostzone, oppLostzoneDisplay_html, oppLostzone_html, oppPrizes, oppPrizes_html, oppViewCards, oppViewCards_html, p1, prizes, prizes_html, roomId, selfContainersDocument, socket, stadium, stadium_html, turn, viewCards, viewCards_html } from '../../front-end.js';
import { removeImages } from '../../image-logic/remove-images.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { buildDeck } from '../../setup/deck-constructor/build-deck.js';
import { determineDeckData } from '../../setup/general/determine-deckdata.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { hideIfEmpty } from './close-popups.js';
import { updateCount } from './update-count.js';

export const reset = (user, clean = false, received = false, build = true, invalidMessage = true) => {
    turn[0] = [0];
    let cardArrays;
    let cardContainers;
    if (stadium.cards[0] && ((stadium.cards[0].image.user === 'self' && user === 'self') || (stadium.cards[0].image.user !== 'self' && user !== 'self'))){
        stadium.cards = [];
        document.querySelectorAll('.tab').forEach(element => {
            element.classList.remove('tab');
        });
        removeImages(stadium_html);
    };
    if (user === 'self'){
        cardArrays = [deck, lostzone, discard, prizes, active, bench, hand, attachedCardPopup, viewCards, board];
        cardContainers = [deckDisplay_html, deck_html, lostzone_html, discard_html, prizes_html, active_html, bench_html, hand_html, lostzoneDisplay_html, discardDisplay_html, attachedCardPopup_html, board_html, viewCards_html]

        selfContainersDocument.querySelectorAll('.self-circle, .opp-circle, .self-tab, .opp-tab').forEach(element => {
            element.textContent = '0'
            element.handleRemove();
        });
        selfContainersDocument.querySelectorAll('.used').forEach(element => {
            element.classList.remove('used');
        });
    } else {
        cardArrays = [oppDeck, oppLostzone, oppDiscard, oppPrizes, oppActive, oppBench, oppHand, oppAttachedCardPopup, oppViewCards, oppBoard];
        cardContainers = [oppDeck_html, oppPrizes_html, oppDeckDisplay_html, oppLostzone_html, oppDiscard_html, oppActive_html, oppBench_html, oppHand_html, oppLostzoneDisplay_html, oppDiscardDisplay_html, oppAttachedCardPopup_html, oppViewCards_html, oppBoard_html]

        oppContainersDocument.querySelectorAll('.self-circle, .opp-circle, .self-tab, .opp-tab').forEach(element => {
            element.textContent = '0'
            element.handleRemove();
        });
        oppContainersDocument.querySelectorAll('.used').forEach(element => {
            element.classList.remove('used');
        });
    };
    cardArrays.forEach(container => container.cards = []);
    cardContainers.forEach(container => removeImages(container));

    hideIfEmpty();

    if (build){
        if (determineDeckData(user)){
            buildDeck(user);
        } else if (invalidMessage){
            appendMessage(user, determineUsername(user) + ' has an invalid deck!', 'announcement', true);
        };
    };

    if (!clean && determineDeckData(user)){
        appendMessage(user, determineUsername(user) + ' reset', 'player', true);
    };

    if (!p1[0] && !received){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : roomId,
            user : oUser,
            clean: clean,
            received: true,
            build: build,
            invalidMessage: invalidMessage
        };
        socket.emit('reset', data);
    };
    updateCount();
}