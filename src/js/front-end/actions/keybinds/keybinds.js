import { mouseClick, systemState } from '../../front-end.js';
import { appendMessage } from '../../setup/chatbox/append-message.js';
import { determineUsername } from '../../setup/general/determine-username.js';
import { doubleClick } from '../../setup/image-logic/click-events.js';
import { getZone } from '../../setup/zones/get-zone.js';
import { addDamageCounter } from '../counters/damage-counter.js';
import { addSpecialCondition } from '../counters/special-condition.js';
import { useAbility } from '../counters/use-ability.js';
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
import { undo } from '../general/undo.js';
import { moveCardBundle } from '../move-card-bundle/move-card-bundle.js';
import { draw, moveToDeckBottom, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop, viewDeck } from '../zones/deck-actions.js';
import { shuffleAll } from '../zones/general.js';
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../zones/hand-actions.js';

export const keyUp = (event) => {
    if (event.key === 'Shift') {
        document.getElementById('keybindModal').style.display = 'none';
    };
}
export const keyDown = (event) => {
    const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
    const blockedClasses = ['self-circle', 'opp-circle', 'self-tab', 'opp-tab'];
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'TD' || blockedClasses.some(className => event.target.classList.contains(className))){
        return;
    };
    if (event.key === 'Escape'){
        hideZoneElements();
        closePopups();
        document.getElementById('keybindModal').style.display = 'none';
    };
    if (event.key === 'Shift') {
        document.getElementById('keybindModal').style.display = 'block';
    };
    if (event.key === 'f' && (event.altKey || event.getModifierState('Alt'))) {
        event.preventDefault();
        if (systemState.coachingMode || !systemState.isTwoPlayer || !notSpectator){
            flipBoard();
        };
    };
    if (!mouseClick.selectingCard){
        if (event.key === 'v') {
            const selectedDeckElement = getZone(systemState.initiator, 'deck').element;
            selectedDeckElement.style.display = 'block';

            const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
            if (notSpectator){
                appendMessage(systemState.initiator, determineUsername(systemState.initiator) + ' is looking through ' + determineUsername(systemState.initiator) + "'s deck", 'player');
            };
        };
    };
    if (mouseClick.selectingCard){
        if (event.key === 'v') {
            doubleClick(null);
        };
    };
    if (notSpectator){
        if (event.key === 'Enter' && !(event.altKey || event.getModifierState('Alt'))){
            discardBoard(systemState.initiator, systemState.initiator);
        };
        if (event.key === 'Enter' && (event.altKey || event.getModifierState('Alt'))){
            handBoard(systemState.initiator, systemState.initiator);
        };
        if (event.key === '/'){
            shuffleBoard(systemState.initiator, systemState.initiator);
        };
        if (event.key === 'f' && !(event.altKey || event.getModifierState('Alt'))) {
            flipCoin(systemState.initiator);
        };
    };
    if (!mouseClick.selectingCard && notSpectator){
        if (event.key >= 1 && event.key <= 9 && !(event.altKey || event.getModifierState('Alt')) && !event.ctrlKey) {
            draw(systemState.initiator, systemState.initiator, event.key);
        };
        if (event.key === 's') {
            shuffleAll(systemState.initiator, systemState.initiator, 'deck');
        };
        if (event.key >= 1 && event.key <= 9 && (event.altKey || event.getModifierState('Alt'))) {
            const selectedDeckCount =  getZone(systemState.initiator, 'deck').getCount();      
            const viewAmount = Math.min(event.key, selectedDeckCount);
            viewDeck(systemState.initiator, systemState.initiator, viewAmount, true, selectedDeckCount, false);
        };
        if (event.key >= 1 && event.key <= 9 && event.ctrlKey) {
            const selectedDeckCount =  getZone(systemState.initiator, 'deck').getCount();      
            const viewAmount = Math.min(event.key, selectedDeckCount);
            viewDeck(systemState.initiator, systemState.initiator, viewAmount, false, selectedDeckCount, false);
        };
        if (event.key === 'n' && (event.altKey || event.getModifierState('Alt'))) {
            setup(systemState.initiator);
        };
        if (event.key === 'r' && (event.altKey || event.getModifierState('Alt'))) {
            reset(systemState.initiator);
        };
        if (event.key === 't' && (event.altKey || event.getModifierState('Alt'))) {
            takeTurn(systemState.initiator, systemState.initiator);
        };
        if (event.key === 'm') {
            appendMessage('', determineUsername(systemState.initiator) + ' mulligans', 'announcement');
        };
        if (event.key === 'd' && (event.altKey || event.getModifierState('Alt'))) {
            discardAndDraw(systemState.initiator, systemState.initiator);
        };
        if (event.key === 's' && (event.altKey || event.getModifierState('Alt'))) {
            shuffleAndDraw(systemState.initiator, systemState.initiator);
        };
        if (event.key === 'ArrowDown' && (event.altKey || event.getModifierState('Alt'))) {
            shuffleBottomAndDraw(systemState.initiator, systemState.initiator);
        };
        if (event.key === 'u') {
            undo(systemState.initiator);
        };
    };
    if (mouseClick.selectingCard && notSpectator){
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
        if (bind && !(event.altKey || event.getModifierState('Alt'))) {
            const dZoneId = bind;
            deselectCard();
            if (event.key === 'ArrowUp'){
                moveToDeckTop(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            } else if (event.key === 'ArrowDown'){
                moveToDeckBottom(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            } else if (event.key === 'ArrowRight'){
                switchWithDeckTop(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            } else if (event.key === 's'){
                shuffleIntoDeck(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            } else {
                moveCardBundle(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, dZoneId, mouseClick.cardIndex, false, 'move');
            };
        };
        if ((event.key === 'e' || event.key === 'q') && !(event.altKey || event.getModifierState('Alt')) && (!['active', 'bench'].includes(mouseClick.zoneId) || mouseClick.card.image.attached)){
            closeFullView(event);
            hideZoneElements();
            deselectCard();
            const highlightedZones = ['active', 'bench'];
            highlightedZones.forEach(zoneId => {
                getZone(mouseClick.cardUser, zoneId).array.forEach(card => {
                    if (!card.image.attached){
                        card.image.classList.add('selectHighlight');
                    };
                });
            });
        };
        if (event.key === 'w' && ['active', 'bench', 'stadium', 'discard'].includes(mouseClick.zoneId)) {
            deselectCard();
            event.preventDefault();
            if (mouseClick.card.image.abilityCounter){
                mouseClick.card.image.abilityCounter.handleRemove();
            } else {
                useAbility(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            };
        };
        if (event.key >= 1 && event.key <= 9 && ['active', 'bench'].includes(mouseClick.zoneId)){
            if (!mouseClick.card.image.damageCounter){
                const damageAmount = parseInt(event.key * 10).toString();
                addDamageCounter(mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex, damageAmount);
            } else {
                let damageAmount = parseInt(mouseClick.card.image.damageCounter.textContent);
                const adjustment = parseInt(event.key * 10);
                if ((event.altKey || event.getModifierState('Alt'))) {
                    damageAmount -= adjustment;
                } else {
                    damageAmount += adjustment;
                };
                mouseClick.card.image.damageCounter.textContent = damageAmount.toString();
                if (mouseClick.card.image.damageCounter.textContent <= 0){
                    deselectCard();
                    mouseClick.card.image.damageCounter.handleRemove(true);
                } else {
                    mouseClick.card.image.damageCounter.handleInput();
                };
            };
        };
        if (event.key === '0' && mouseClick.card.image.damageCounter){
            deselectCard();
            mouseClick.card.image.damageCounter.textContent = event.key;
            mouseClick.card.image.damageCounter.handleRemove(true);
        };
        if (event.key === 'y' && mouseClick.zoneId === 'active'){
            if (!mouseClick.card.image.specialCondition){
                addSpecialCondition(mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex);
            } else {
                if (!(event.altKey || event.getModifierState('Alt'))){
                    switch (mouseClick.card.image.specialCondition.textContent.toUpperCase()) {
                        case 'P':
                            mouseClick.card.image.specialCondition.textContent = 'B';
                            mouseClick.card.image.specialCondition.handleColor();
                            break;
                        case 'B':
                            mouseClick.card.image.specialCondition.textContent = 'Pa';
                            mouseClick.card.image.specialCondition.handleColor();
                            break;
                        case 'PA':
                            mouseClick.card.image.specialCondition.textContent = 'C';
                            mouseClick.card.image.specialCondition.handleColor();
                            break;
                        case 'C':
                            mouseClick.card.image.specialCondition.textContent = 'A';
                            mouseClick.card.image.specialCondition.handleColor();
                            break;
                        case 'A':
                            mouseClick.card.image.specialCondition.textContent = 'P';
                            mouseClick.card.image.specialCondition.handleColor();
                            break;
                    };
                } else {
                    mouseClick.card.image.specialCondition.textContent = '';
                    mouseClick.card.image.specialCondition.handleRemove(true);
                    deselectCard();
                };
            };
        };
        if (event.key === 'r' && !(event.altKey || event.getModifierState('Alt')) && ['stadium', 'active', 'bench'].includes(mouseClick.zoneId) && !mouseClick.card.image.parentElement.classList.contains('full-view')) {
            rotateCard(mouseClick.cardUser, mouseClick.zoneId, mouseClick.cardIndex);
        };
        if (event.key === 'r' && (event.altKey || event.getModifierState('Alt')) && ['active', 'bench'].includes(mouseClick.zoneId) && !mouseClick.card.image.parentElement.classList.contains('full-view')){
            rotateCard(mouseClick.cardUser, mouseClick.zoneId,mouseClick.cardIndex, true);
        };
        if (event.key ==='c'){
            if ([systemState.cardBackSrc, systemState.p1OppCardBackSrc, systemState.p2OppCardBackSrc].includes(mouseClick.card.image.src)){
                lookShortcut(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            } else {
                stopLookingShortcut(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            };
        };
        if (event.key === 'z' && !(event.altKey || event.getModifierState('Alt'))){
            if (![systemState.cardBackSrc, systemState.p1OppCardBackSrc, systemState.p2OppCardBackSrc].includes(mouseClick.card.image.src)){
                hideShortcut(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
            };
        };
        if (event.key === 'z' && (event.altKey || event.getModifierState('Alt'))){
            revealShortcut(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex);
        };
        if (event.key === 'e' && (event.altKey || event.getModifierState('Alt'))){
            changeType(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex, 'Energy');
        };
        if (event.key === 't' && (event.altKey || event.getModifierState('Alt'))){
            changeType(mouseClick.cardUser, systemState.initiator, mouseClick.zoneId, mouseClick.cardIndex, 'Trainer');
        };
    };
}