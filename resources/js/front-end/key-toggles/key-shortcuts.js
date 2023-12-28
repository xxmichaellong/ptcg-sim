import { moveToDeckBottom, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop, viewDeck } from '../actions/container/deck-actions.js';
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../actions/container/hand-actions.js';
import { shuffleContainer } from '../actions/container/shuffle-container.js';
import { addAbilityCounter } from '../actions/counters/ability-counter.js';
import { addDamageCounter } from '../actions/counters/damage-counter.js';
import { addSpecialCondition } from '../actions/counters/special-condition.js';
import { discardBoard, handBoard, lostzoneBoard, shuffleBoard } from '../actions/general/clear-board.js';
import { closeContainerPopups, closeFullView, closePopups, deselectCard } from '../actions/general/close-popups.js';
import { flipBoard } from '../actions/general/flip-board.js';
import { flipCoin } from '../actions/general/flip-coin.js';
import { moveCard } from '../actions/general/move-card.js';
import { reset } from '../actions/general/reset.js';
import { hideShortcut, lookShortcut, revealShortcut, stopLookingShortcut } from '../actions/general/reveal-and-hide.js';
import { rotateCard } from '../actions/general/rotate-card.js';
import { setup } from '../actions/general/setup.js';
import { takeTurn } from '../actions/general/take-turn.js';
import { sCard, keybindModal, target, deck, oppDeck, POV, deck_html, oppDeck_html, active, bench, oppActive, oppBench, p1, socket, roomId, stadium } from '../front-end.js';
import { doubleClick } from '../image-logic/click-events.js';
import { moveCardMessage } from '../setup/chatbox/location-name.js';
import { appendMessage } from '../setup/chatbox/messages.js';
import { variableToString } from '../setup/containers/string-to-variable.js';
import { determineUsername } from '../setup/general/determine-username.js';

export const keyUp = (event) => {
    if (event.key === 'Shift') {
        keybindModal.style.display = 'none';
    };
}
export const keyDown = (event) => {
    if (event.key === 'Escape'){
        closeContainerPopups();
        closePopups();
    };
    if (event.key === 'Enter' && !event.altKey){
        discardBoard(POV.user);
    };
    if (event.key === 'Enter' && event.altKey){
        handBoard(POV.user);
    };
    if (event.key === '/'){
        shuffleBoard(POV.user);
    };
    const blockedClasses = ['self-circle', 'opp-circle', 'self-tab', 'opp-tab'];
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || blockedClasses.some(className => event.target.classList.contains(className))){
        return;
    };
    if (event.key === 'Shift') {
        keybindModal.style.display = 'block';
    };
    if (!sCard.selecting){
        if (event.key >= 1 && event.key <= 9 && !event.altKey && !event.ctrlKey) {
            const deckCount = POV.user === 'self' ? deck.count : oppDeck.count;
            const drawAmount = Math.min(event.key, deckCount);
            for (let i = 0; i < drawAmount; i++){
                moveCard(POV.user, 'deck', 'deck_html', 'hand', 'hand_html', 0);
            };
            let message;
            if (drawAmount > 1){
                message = determineUsername(POV.user) + ' drew ' + drawAmount + ' cards';
                appendMessage(POV.user, message, 'player');
            } else if (drawAmount === 1){
                message = determineUsername(POV.user) + ' drew a card';
                appendMessage(POV.user, message, 'player');
            };
        };
        if (event.key === 's') {
            shuffleContainer(POV.user, 'deck', 'deck_html');
            appendMessage(POV.user, determineUsername(POV.user) + ' shuffled deck', 'player');
        };
        if (event.key >= 1 && event.key <= 9 && event.altKey) {
            const deckCount = POV.user === 'self' ? deck.count : oppDeck.count;        
            const viewAmount = Math.min(event.key, deckCount);
            viewDeck(POV.user, viewAmount, true, deckCount, false);
        };
        if (event.key >= 1 && event.key <= 9 && event.ctrlKey) {
            const deckCount = POV.user === 'self' ? deck.count : oppDeck.count;        
            const viewAmount = Math.min(event.key, deckCount);
            viewDeck(POV.user, viewAmount, false, deckCount, false);
        };
        if (event.key === 'v') {
            const deckDisplay = POV.user === 'self' ? deck_html : oppDeck_html;
            deckDisplay.style.display = 'block';
        };
        if (event.key === 'n' && event.altKey) {
            setup(POV.user);
        };
        if (event.key === 'r' && event.altKey) {
            reset(POV.user);
        };
        if (event.key === 't' && event.altKey) {
            takeTurn(POV.user);
        };
        if (event.key === 'f' && !event.altKey) {
            flipCoin(POV.user);
        };
        if (event.key === 'f' && event.altKey) {
            event.preventDefault();
            flipBoard();
        };
        if (event.key === 'm') {
            appendMessage(POV.user, determineUsername(POV.user) + ' mulligans', 'announcement');
        };
        if (event.key === 'd' && event.altKey) {
            discardAndDraw(POV.user);
        };
        if (event.key === 's' && event.altKey) {
            shuffleAndDraw(POV.user);
        };
        if (event.key === 'ArrowDown' && event.altKey) {
            shuffleBottomAndDraw(POV.user);
        };
    };
    if (sCard.selecting){
        event.preventDefault();
        
        const keyBinds = {
            'h': { locationAsString: 'hand', containerId: 'hand_html' },
            'd': { locationAsString: 'discard', containerId: 'discard_html' },
            'b': { locationAsString: 'bench', containerId: 'bench_html' },
            'a': { locationAsString: 'active', containerId: 'active_html' },
            'g': { locationAsString: 'stadium', containerId: 'stadium_html' },
            'l': { locationAsString: 'lostzone', containerId: 'lostzone_html' },
            'p': { locationAsString: 'prizes', containerId: 'prizes_html' },
            ' ': { locationAsString: 'board', containerId: 'board_html' },
            'ArrowUp': { locationAsString: 'deck', containerId: 'deck_html' },
            'ArrowDown': { locationAsString: 'deck', containerId: 'deck_html' },
            'ArrowRight': { locationAsString: 'deck', containerId: 'deck_html' },
            's': { locationAsString: 'deck', containerId: 'deck_html' },
        };
        const bind = keyBinds[event.key];
        if (bind && !event.altKey) {
            target.locationAsString = bind.locationAsString;
            target.containerId = bind.containerId;
            target.index = '';
            deselectCard();
            if (event.key === 'ArrowUp'){
                moveToDeckTop();
            } else if (event.key === 'ArrowDown'){
                moveToDeckBottom();
            } else if (event.key === 'ArrowRight'){
                switchWithDeckTop();
            } else if (event.key === 's'){
                shuffleIntoDeck();
            } else {
                moveCardMessage(POV.user, sCard.card.name, sCard.locationAsString, target.locationAsString, 'move', sCard.card.image.attached, sCard.card.image.faceDown);
                moveCard(sCard.user, sCard.locationAsString, sCard.containerId, target.locationAsString, target.containerId, sCard.index, target.index);
            };
        };
        if ((event.key === 'e' || event.key === 'q') && (!['active', 'bench'].includes(sCard.locationAsString) || sCard.card.image.attached)){
            closeFullView(event);
            closeContainerPopups();
            deselectCard();

            const highlightUnattachedCards = (cards) => {
                cards.forEach(card => {
                    if (!card.image.attached){
                        card.image.classList.add('selectHighlight');
                    };
                });
            }
            if (sCard.user === 'self') {
                highlightUnattachedCards(active.cards);
                highlightUnattachedCards(bench.cards);
            } else {
                highlightUnattachedCards(oppActive.cards);
                highlightUnattachedCards(oppBench.cards);
            };
        };
        if (event.key === 'v') {
            doubleClick(null);
        };
        if (event.key === 'w' && ['active_html', 'bench_html', 'stadium_html'].includes(sCard.containerId)) {
            deselectCard();
            event.preventDefault();
            if (sCard.card.image.abilityCounter){
                sCard.card.image.abilityCounter.handleRemove();
            } else {
                addAbilityCounter(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index);
                if (sCard.location !== stadium){
                    appendMessage(POV.user, determineUsername(POV.user) + ' used ' + sCard.card.name + "'s ability", 'player');
                } else {
                    appendMessage(POV.user, determineUsername(POV.user) + ' used ' + sCard.card.name, 'player');
                };
            };
        };
        if (event.key >= 1 && event.key <= 9 && ['active_html', 'bench_html'].includes(sCard.containerId)){
            if (!sCard.card.image.damageCounter){
                addDamageCounter(sCard.user, sCard.locationAsString, sCard.containerId, sCard.index);
                const damage = parseInt(event.key * 10);
                sCard.card.image.damageCounter.textContent = damage.toString();
            } else {
                let damage = parseInt(sCard.card.image.damageCounter.textContent);
                const amount = parseInt(event.key * 10);
                if (event.altKey) {
                    damage -= amount;
                } else {
                    damage += amount;
                };
                sCard.card.image.damageCounter.textContent = damage.toString();
                if (sCard.card.image.damageCounter.textContent <= 0){
                    deselectCard();
                    sCard.card.image.damageCounter.handleRemove(true);
                };
            };
            if (!p1[0] && sCard.card.image.damageCounter){
                const data = {
                    roomId : roomId,
                    user : sCard.oUser,
                    location: sCard.locationAsString,
                    index: sCard.index,
                    textContent: sCard.card.image.damageCounter.textContent
                };
                socket.emit('updateDamageCounter', data);
            };
        };
        if (event.key === '0' && sCard.card.image.damageCounter){
            deselectCard();
            sCard.card.image.damageCounter.textContent = event.key;
            sCard.card.image.damageCounter.handleRemove(true);
        };
        if (event.key === 'y' && sCard.containerId === 'active_html'){
            if (!sCard.card.image.specialCondition){
                addSpecialCondition(sCard.user, sCard.locationAsString, sCard.containerId, sCard.index);
            } else {
                if (!event.altKey){
                    switch (sCard.card.image.specialCondition.textContent.toUpperCase()) {
                        case 'P':
                            sCard.card.image.specialCondition.textContent = 'B';
                            break;
                        case 'B':
                            sCard.card.image.specialCondition.textContent = 'Pa';
                            break;
                        case 'PA':
                            sCard.card.image.specialCondition.textContent = 'C';
                            break;
                        case 'C':
                            sCard.card.image.specialCondition.textContent = 'A';
                            break;
                        case 'A':
                            sCard.card.image.specialCondition.textContent = 'P';
                            break;
                    };
                    sCard.card.image.specialCondition.handleColour();
                } else {
                    sCard.card.image.specialCondition.textContent = '';
                    sCard.card.image.specialCondition.handleRemove(true);
                    deselectCard();
                };
                if (!p1[0] && sCard.card.image.specialCondition){
                    const data = {
                        roomId : roomId,
                        user : sCard.oUser,
                        location: sCard.locationAsString,
                        index: sCard.index,
                        textContent: sCard.card.image.specialCondition.textContent
                    };
                    socket.emit('updateSpecialCondition', data);
                };
            };

        };
        if (event.key === 'r' && !event.altKey && ['stadium', 'active', 'bench'].includes(sCard.locationAsString) && !sCard.card.image.parentElement.classList.contains('fullView')) {
            rotateCard(sCard.user, sCard.locationAsString, sCard.containerId, sCard.index);
        };
        if (event.key === 'r' && event.altKey && ['active', 'bench'].includes(sCard.locationAsString) && !sCard.card.image.parentElement.classList.contains('fullView')){
            rotateCard(sCard.user, sCard.locationAsString, sCard.containerId, sCard.index, true);
        };
        if (event.key ==='c'){
            let rootDirectory = window.location.origin;
            if (sCard.card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
                lookShortcut(sCard.user, sCard.locationAsString, sCard.index);
            } else {
                stopLookingShortcut(sCard.user, sCard.locationAsString, sCard.index);
            };
        };
        if (event.key === 'z'){
            let rootDirectory = window.location.origin;
            if (sCard.card.image.src === rootDirectory + '/resources/card-scans/cardback.png'){
                revealShortcut(sCard.user, sCard.locationAsString, sCard.index);
            } else {
                hideShortcut(sCard.user, sCard.locationAsString, sCard.index);
            };
        };
    };
}