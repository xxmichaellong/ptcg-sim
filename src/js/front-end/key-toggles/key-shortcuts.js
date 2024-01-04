import { moveToDeckBottom, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop, viewDeck } from '../actions/zones/deck-actions.js';
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../actions/zones/hand-actions.js';
import { shuffleZone } from '../actions/zones/shuffle-zone.js';
import { addAbilityCounter } from '../actions/counters/ability-counter.js';
import { addDamageCounter } from '../actions/counters/damage-counter.js';
import { addSpecialCondition } from '../actions/counters/special-condition.js';
import { changeType } from '../actions/general/change-type.js';
import { discardBoard, handBoard, shuffleBoard } from '../actions/general/board-actions.js';
import { hideZoneElements, closeFullView, closePopups, deselectCard } from '../actions/general/close-popups.js';
import { flipBoard } from '../actions/general/flip-board.js';
import { flipCoin } from '../actions/general/flip-coin.js';
import { moveCard } from '../actions/move-card-logic/move-card.js';
import { reset } from '../actions/general/reset.js';
import { hideShortcut, lookShortcut, revealShortcut, stopLookingShortcut } from '../actions/general/reveal-and-hide.js';
import { rotateCard } from '../actions/general/rotate-card.js';
import { setup } from '../actions/general/setup.js';
import { takeTurn } from '../actions/general/take-turn.js';
import { sCard, keybindModal, target, deckArray, oppDeckArray, deckElement, oppDeckElement, activeArray, benchArray, oppActiveArray, oppBenchArray, systemState, socket, stadiumArray } from '../front-end.js';
import { doubleClick } from '../image-logic/click-events.js';
import { moveCardMessage } from '../setup/chatbox/move-card-message.js';
import { appendMessage } from '../setup/chatbox/messages.js';
import { variableToString } from '../setup/zones/zone-string-to-variable.js';
import { determineUsername } from '../setup/general/determine-username.js';
import { getZoneCount } from '../actions/general/count.js';

export const keyUp = (event) => {
    if (event.key === 'Shift') {
        keybindModal.style.display = 'none';
    };
}
export const keyDown = (event) => {
    if (event.key === 'Escape'){
        hideZoneElements();
        closePopups();
    };
    if (event.key === 'Enter' && !event.altKey){
        discardBoard(systemState.pov.user);
    };
    if (event.key === 'Enter' && event.altKey){
        handBoard(systemState.pov.user);
    };
    if (event.key === '/'){
        shuffleBoard(systemState.pov.user);
    };
    const blockedClasses = ['self-circle', 'opp-circle', 'self-tab', 'opp-tab'];
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || blockedClasses.some(className => event.target.classList.contains(className))){
        return;
    };
    if (event.key === 'Shift') {
        keybindModal.style.display = 'block';
    };
    if (!sCard.keybinds){
        if (event.key >= 1 && event.key <= 9 && !event.altKey && !event.ctrlKey) {
            const selectedDeckCount = systemState.pov.user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);
            const drawAmount = Math.min(event.key, selectedDeckCount);
            for (let i = 0; i < drawAmount; i++){
                moveCard(systemState.pov.user, 'deckArray', 'deckElement', 'handArray', 'handElement', 0);
            };
            let message;
            if (drawAmount > 1){
                message = determineUsername(systemState.pov.user) + ' drew ' + drawAmount + ' cards';
                appendMessage(systemState.pov.user, message, 'player');
            } else if (drawAmount === 1){
                message = determineUsername(systemState.pov.user) + ' drew a card';
                appendMessage(systemState.pov.user, message, 'player');
            };
        };
        if (event.key === 's') {
            shuffleZone(systemState.pov.user, 'deckArray', 'deckElement');
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' shuffled deck', 'player');
        };
        if (event.key >= 1 && event.key <= 9 && event.altKey) {
            const selectedDeckCount = systemState.pov.user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);        
            const viewAmount = Math.min(event.key, selectedDeckCount);
            viewDeck(systemState.pov.user, viewAmount, true, selectedDeckCount, false);
        };
        if (event.key >= 1 && event.key <= 9 && event.ctrlKey) {
            const selectedDeckCount = systemState.pov.user === 'self' ? getZoneCount(deckArray) : getZoneCount(oppDeckArray);        
            const viewAmount = Math.min(event.key, selectedDeckCount);
            viewDeck(systemState.pov.user, viewAmount, false, selectedDeckCount, false);
        };
        if (event.key === 'v') {
            const selectedDeckElement = systemState.pov.user === 'self' ? deckElement : oppDeckElement;
            selectedDeckElement.style.display = 'block';
        };
        if (event.key === 'n' && event.altKey) {
            setup(systemState.pov.user);
        };
        if (event.key === 'r' && event.altKey) {
            reset(systemState.pov.user);
        };
        if (event.key === 't' && event.altKey) {
            takeTurn(systemState.pov.user);
        };
        if (event.key === 'f' && !event.altKey) {
            flipCoin(systemState.pov.user);
        };
        if (event.key === 'f' && event.altKey) {
            event.preventDefault();
            flipBoard();
        };
        if (event.key === 'm') {
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' mulligans', 'announcement');
        };
        if (event.key === 'd' && event.altKey) {
            discardAndDraw(systemState.pov.user);
        };
        if (event.key === 's' && event.altKey) {
            shuffleAndDraw(systemState.pov.user);
        };
        if (event.key === 'ArrowDown' && event.altKey) {
            shuffleBottomAndDraw(systemState.pov.user);
        };
    };
    if (sCard.keybinds){
        event.preventDefault();
        
        const keyBinds = {
            'h': { zoneArrayString: 'handArray', zoneElementString: 'handElement' },
            'd': { zoneArrayString: 'discardArray', zoneElementString: 'discardElement' },
            'b': { zoneArrayString: 'benchArray', zoneElementString: 'benchElement' },
            'a': { zoneArrayString: 'activeArray', zoneElementString: 'activeElement' },
            'g': { zoneArrayString: 'stadiumArray', zoneElementString: 'stadiumElement' },
            'l': { zoneArrayString: 'lostZoneArray', zoneElementString: 'lostZoneElement' },
            'p': { zoneArrayString: 'prizesArray', zoneElementString: 'prizesElement' },
            ' ': { zoneArrayString: 'boardArray', zoneElementString: 'boardElement' },
            'ArrowUp': { zoneArrayString: 'deckArray', zoneElementString: 'deckElement' },
            'ArrowDown': { zoneArrayString: 'deckArray', zoneElementString: 'deckElement' },
            'ArrowRight': { zoneArrayString: 'deckArray', zoneElementString: 'deckElement' },
            's': { zoneArrayString: 'deckArray', zoneElementString: 'deckElement' },
        };
        const bind = keyBinds[event.key];
        if (bind && !event.altKey) {
            target.zoneArrayString = bind.zoneArrayString;
            target.zoneElementString = bind.zoneElementString;
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
                moveCardMessage(systemState.pov.user, sCard.card.name, sCard.zoneArrayString, target.zoneArrayString, 'move', sCard.card.image.attached, sCard.card.image.faceDown, sCard.card.image.faceUp);
                moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, target.zoneArrayString, target.zoneElementString, sCard.index, target.index);
            };
        };
        if ((event.key === 'e' || event.key === 'q') && !event.altKey && (!['activeArray', 'benchArray'].includes(sCard.zoneArrayString) || sCard.card.image.attached)){
            closeFullView(event);
            hideZoneElements();
            deselectCard();

            const highlightUnattachedCardss = (cards) => {
                cards.forEach(card => {
                    if (!card.image.attached){
                        card.image.classList.add('selectHighlight');
                    };
                });
            }
            if (sCard.user === 'self') {
                highlightUnattachedCardss(activeArray);
                highlightUnattachedCardss(benchArray);
            } else {
                highlightUnattachedCardss(oppActiveArray);
                highlightUnattachedCardss(oppBenchArray);
            };
        };
        if (event.key === 'v') {
            doubleClick(null);
        };
        if (event.key === 'w' && ['activeElement', 'benchElement', 'stadiumElement'].includes(sCard.zoneElementString)) {
            deselectCard();
            event.preventDefault();
            if (sCard.card.image.abilityCounter){
                sCard.card.image.abilityCounter.handleRemove();
            } else {
                addAbilityCounter(sCard.user, variableToString(sCard.user, sCard.zoneArray), variableToString(sCard.user, sCard.zoneElement), sCard.index);
                if (sCard.zoneArray !== stadiumArray){
                    appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' used ' + sCard.card.name + "'s ability", 'player');
                } else {
                    appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' used ' + sCard.card.name, 'player');
                };
            };
        };
        if (event.key >= 1 && event.key <= 9 && ['activeElement', 'benchElement'].includes(sCard.zoneElementString)){
            if (!sCard.card.image.damageCounter){
                addDamageCounter(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, sCard.index);
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
            if (systemState.isTwoPlayer && sCard.card.image.damageCounter){
                const data = {
                    roomId : systemState.roomId,
                    user : sCard.oUser,
                    zoneArrayString: sCard.zoneArrayString,
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
        if (event.key === 'y' && sCard.zoneElementString === 'activeElement'){
            if (!sCard.card.image.specialCondition){
                addSpecialCondition(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, sCard.index);
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
                if (systemState.isTwoPlayer && sCard.card.image.specialCondition){
                    const data = {
                        roomId : systemState.roomId,
                        user : sCard.oUser,
                        zoneArrayString: sCard.zoneArrayString,
                        index: sCard.index,
                        textContent: sCard.card.image.specialCondition.textContent
                    };
                    socket.emit('updateSpecialCondition', data);
                };
            };

        };
        if (event.key === 'r' && !event.altKey && ['stadiumArray', 'activeArray', 'benchArray'].includes(sCard.zoneArrayString) && !sCard.card.image.parentElement.classList.contains('full-view')) {
            rotateCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, sCard.index);
        };
        if (event.key === 'r' && event.altKey && ['activeArray', 'benchArray'].includes(sCard.zoneArrayString) && !sCard.card.image.parentElement.classList.contains('full-view')){
            rotateCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, sCard.index, true);
        };
        if (event.key ==='c'){
            let rootDirectory = window.location.origin;
            if (sCard.card.image.src === rootDirectory + '/src/cardback.png'){
                lookShortcut(sCard.user, sCard.zoneArrayString, sCard.index);
            } else {
                stopLookingShortcut(sCard.user, sCard.zoneArrayString, sCard.index);
            };
        };
        if (event.key === 'z' && !event.altKey){
            let rootDirectory = window.location.origin;
            if (sCard.card.image.src !== rootDirectory + '/src/cardback.png'){
                hideShortcut(sCard.user, sCard.zoneArrayString, sCard.index);
            };
        };
        if (event.key === 'z' && event.altKey){
            revealShortcut(sCard.user, sCard.zoneArrayString, sCard.index);
        };

        if (event.key === 'e' && event.altKey){
            changeType(sCard.user, sCard.zoneArrayString, sCard.index, 'Energy');
            appendMessage(sCard.user, determineUsername(sCard.user) + ' changed ' + sCard.card.name + ' into an energy', 'player');
            moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'boardArray', 'boardElement', sCard.index);        
        };
        if (event.key === 'p' && event.altKey){
            changeType(sCard.user, sCard.zoneArrayString, sCard.index, 'Pokémon');
            appendMessage(sCard.user, determineUsername(sCard.user) + ' changed ' + sCard.card.name + ' into a Pokémon', 'player');
            moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'boardArray', 'boardElement', sCard.index);       
        };
        if (event.key === 't' && event.altKey){
            changeType(sCard.user, sCard.zoneArrayString, sCard.index, 'Trainer');
            appendMessage(sCard.user, determineUsername(sCard.user) + ' changed ' + sCard.card.name + ' into a tool', 'player');
            moveCard(sCard.user, sCard.zoneArrayString, sCard.zoneElementString, 'boardArray', 'boardElement', sCard.index);        
        };
    };
}