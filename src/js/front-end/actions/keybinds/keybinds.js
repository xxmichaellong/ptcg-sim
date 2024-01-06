import { mouseClick, socket, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/messages.js';
import { moveCardMessage } from '../../setup/chatbox/move-card-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { doubleClick } from '../../setup/image-logic/click-events.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { addAbilityCounter } from '../counters/ability-counter.js';
import { addDamageCounter } from '../counters/damage-counter.js';
import { addSpecialCondition } from '../counters/special-condition.js';
import { discardBoard, handBoard, shuffleBoard } from '../general/board-actions.js';
import { changeType } from '../general/change-type.js';
import { closeFullView, closePopups, deselectCard, hideZoneElements } from '../general/close-popups.js';
import { flipBoard } from '../general/flip-board.js';
import { flipCoin } from '../general/flip-coin.js';
import { reset } from '../general/reset.js';
import { hideShortcut, lookShortcut, revealShortcut, stopLookingShortcut } from '../general/reveal-and-hide.js';
import { rotateCard } from '../general/rotate-card.js';
import { setup } from '../general/setup.js';
import { takeTurn } from '../general/take-turn.js';
import { moveCard } from '../move-card-logic/move-card.js';
import { moveToDeckBottom, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop, viewDeck } from '../zones/deck-actions.js';
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../zones/hand-actions.js';
import { shuffleZone } from '../zones/shuffle-zone.js';

export const keyUp = (event) => {
    if (event.key === 'Shift') {
        document.getElementById('keybindModal').style.display = 'none';
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
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'TD' || blockedClasses.some(className => event.target.classList.contains(className))){
        return;
    };
    if (event.key === 'Shift') {
        document.getElementById('keybindModal').style.display = 'block';
    };
    if (!mouseClick.selectingCard){
        if (event.key >= 1 && event.key <= 9 && !event.altKey && !event.ctrlKey) {
            const selectedDeckCount =  getZone(systemState.pov.user, 'deck').getCount();      
            const drawAmount = Math.min(event.key, selectedDeckCount);
            for (let i = 0; i < drawAmount; i++){
                moveCard(systemState.pov.user, 'deck', 'hand', 0);
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
            shuffleZone(systemState.pov.user, 'deck');
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' shuffled deck', 'player');
        };
        if (event.key >= 1 && event.key <= 9 && event.altKey) {
            const selectedDeckCount =  getZone(systemState.pov.user, 'deck').getCount();      
            const viewAmount = Math.min(event.key, selectedDeckCount);
            viewDeck(systemState.pov.user, viewAmount, true, selectedDeckCount, false);
        };
        if (event.key >= 1 && event.key <= 9 && event.ctrlKey) {
            const selectedDeckCount =  getZone(systemState.pov.user, 'deck').getCount();      
            const viewAmount = Math.min(event.key, selectedDeckCount);
            viewDeck(systemState.pov.user, viewAmount, false, selectedDeckCount, false);
        };
        if (event.key === 'v') {
            const selectedDeckElement = getZone(systemState.pov.user, 'deck').element;
            selectedDeckElement.style.display = 'block';
            appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' is looking through ' + determineUsername(systemState.pov.user) + "'s deck", 'player');
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
    if (mouseClick.selectingCard){
        event.preventDefault();
        
        const keyBinds = {
            'h': 'hand',
            'd': 'discard',
            'b': 'bench',
            'a': 'active',
            'g': 'stadium',
            'l': 'lostZone',
            'p': 'prizes',
            ' ': 'board',
            'ArrowUp': 'deck',
            'ArrowDown': 'deck',
            'ArrowRight': 'deck',
            's': 'deck',
        };
        const bind = keyBinds[event.key];
        if (bind && !event.altKey) {
            const dZoneId = bind;
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
                moveCardMessage(systemState.pov.user, mouseClick.card.name, mouseClick.zoneId, dZoneId, 'move', mouseClick.card.image.attached, mouseClick.card.image.faceDown, mouseClick.card.image.faceUp);
                moveCard(mouseClick.user, mouseClick.zoneId, dZoneId, mouseClick.cardIndex);
            };
        };
        if ((event.key === 'e' || event.key === 'q') && !event.altKey && (!['active', 'bench'].includes(mouseClick.zoneId) || mouseClick.card.image.attached)){
            closeFullView(event);
            hideZoneElements();
            deselectCard();

            const highlightedZones = ['active', 'bench'];
            highlightedZones.forEach(zoneId => {
                getZone(mouseClick.user, zoneId).array.forEach(card => {
                    if (!card.image.attached){
                        card.image.classList.add('selectHighlight');
                    };
                });
            });
        };
        if (event.key === 'v') {
            doubleClick(null);
        };
        if (event.key === 'w' && ['active', 'bench', 'stadium'].includes(mouseClick.zoneId)) {
            deselectCard();
            event.preventDefault();
            if (mouseClick.card.image.abilityCounter){
                mouseClick.card.image.abilityCounter.handleRemove();
            } else {
                addAbilityCounter(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
                if (mouseClick.zoneId !== 'stadium'){
                    appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' used ' + mouseClick.card.name + "'s ability", 'player');
                } else {
                    appendMessage(systemState.pov.user, determineUsername(systemState.pov.user) + ' used ' + mouseClick.card.name, 'player');
                };
            };
        };
        if (event.key >= 1 && event.key <= 9 && ['active', 'bench'].includes(mouseClick.zoneId)){
            if (!mouseClick.card.image.damageCounter){
                addDamageCounter(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
                const damage = parseInt(event.key * 10);
                mouseClick.card.image.damageCounter.textContent = damage.toString();
            } else {
                let damage = parseInt(mouseClick.card.image.damageCounter.textContent);
                const amount = parseInt(event.key * 10);
                if (event.altKey) {
                    damage -= amount;
                } else {
                    damage += amount;
                };
                mouseClick.card.image.damageCounter.textContent = damage.toString();
                if (mouseClick.card.image.damageCounter.textContent <= 0){
                    deselectCard();
                    mouseClick.card.image.damageCounter.handleRemove(true);
                };
            };
            if (systemState.isTwoPlayer && mouseClick.card.image.damageCounter){
                const data = {
                    roomId : systemState.roomId,
                    user : mouseClick.oUser,
                    zoneId: mouseClick.zoneId,
                    index: mouseClick.cardIndex,
                    textContent: mouseClick.card.image.damageCounter.textContent
                };
                socket.emit('updateDamageCounter', data);
            };
        };
        if (event.key === '0' && mouseClick.card.image.damageCounter){
            deselectCard();
            mouseClick.card.image.damageCounter.textContent = event.key;
            mouseClick.card.image.damageCounter.handleRemove(true);
        };
        if (event.key === 'y' && mouseClick.zoneId === 'active'){
            if (!mouseClick.card.image.specialCondition){
                addSpecialCondition(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
            } else {
                if (!event.altKey){
                    switch (mouseClick.card.image.specialCondition.textContent.toUpperCase()) {
                        case 'P':
                            mouseClick.card.image.specialCondition.textContent = 'B';
                            break;
                        case 'B':
                            mouseClick.card.image.specialCondition.textContent = 'Pa';
                            break;
                        case 'PA':
                            mouseClick.card.image.specialCondition.textContent = 'C';
                            break;
                        case 'C':
                            mouseClick.card.image.specialCondition.textContent = 'A';
                            break;
                        case 'A':
                            mouseClick.card.image.specialCondition.textContent = 'P';
                            break;
                    };
                    mouseClick.card.image.specialCondition.handleColor();
                } else {
                    mouseClick.card.image.specialCondition.textContent = '';
                    mouseClick.card.image.specialCondition.handleRemove(true);
                    deselectCard();
                };
                if (systemState.isTwoPlayer && mouseClick.card.image.specialCondition){
                    const data = {
                        roomId : systemState.roomId,
                        user : mouseClick.oUser,
                        zoneId: mouseClick.zoneId,
                        index: mouseClick.cardIndex,
                        textContent: mouseClick.card.image.specialCondition.textContent
                    };
                    socket.emit('updateSpecialCondition', data);
                };
            };

        };
        if (event.key === 'r' && !event.altKey && ['stadium', 'active', 'bench'].includes(mouseClick.zoneId) && !mouseClick.card.image.parentElement.classList.contains('full-view')) {
            rotateCard(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
        };
        if (event.key === 'r' && event.altKey && ['active', 'bench'].includes(mouseClick.zoneId) && !mouseClick.card.image.parentElement.classList.contains('full-view')){
            rotateCard(mouseClick.user, mouseClick.zoneId,mouseClick.cardIndex, true);
        };
        if (event.key ==='c'){
            let rootDirectory = window.location.origin;
            if (mouseClick.card.image.src === rootDirectory + '/src/cardback.png'){
                lookShortcut(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
            } else {
                stopLookingShortcut(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
            };
        };
        if (event.key === 'z' && !event.altKey){
            let rootDirectory = window.location.origin;
            if (mouseClick.card.image.src !== rootDirectory + '/src/cardback.png'){
                hideShortcut(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
            };
        };
        if (event.key === 'z' && event.altKey){
            revealShortcut(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex);
        };

        if (event.key === 'e' && event.altKey){
            changeType(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex, 'Energy');
            const cardName = mouseClick.card.image.faceDown ? 'card' : mouseClick.card.name;
            appendMessage(mouseClick.user, determineUsername(mouseClick.user) + ' changed ' + cardName + ' into an energy', 'player');
            moveCard(mouseClick.user, mouseClick.zoneId, 'board', mouseClick.cardIndex);        
        };
        // if (event.key === 'p' && event.altKey){
        //     changeType(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex, 'Pokémon');
        //     appendMessage(mouseClick.user, determineUsername(mouseClick.user) + ' changed ' + mouseClick.card.name + ' into a Pokémon', 'player');
        //     moveCard(mouseClick.user, mouseClick.zoneId, 'board', mouseClick.cardIndex);       
        // };
        if (event.key === 't' && event.altKey){
            changeType(mouseClick.user, mouseClick.zoneId, mouseClick.cardIndex, 'Trainer');
            const cardName = mouseClick.card.image.faceDown ? 'card' : mouseClick.card.name;
            appendMessage(mouseClick.user, determineUsername(mouseClick.user) + ' changed ' + cardName + ' into a tool', 'player');
            moveCard(mouseClick.user, mouseClick.zoneId, 'board', mouseClick.cardIndex);
        };
    };
}