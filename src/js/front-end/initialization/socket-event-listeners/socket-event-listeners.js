import { attack, pass } from '../../actions/chat-buttons/chat-buttons.js'
import { addDamageCounter } from '../../actions/counters/damage-counter.js'
import { addSpecialCondition } from '../../actions/counters/special-condition.js'
import { useAbility } from '../../actions/counters/use-ability.js'
import { VSTARGXFunction } from '../../actions/general/VSTAR-GX.js'
import { discardBoard, handBoard, lostZoneBoard, shuffleBoard } from '../../actions/general/board-actions.js'
import { changeType } from '../../actions/general/change-type.js'
import { flipBoard } from '../../actions/general/flip-board.js'
import { reset } from '../../actions/general/reset.js'
import { hideCards, hideShortcut, lookAtCards, lookShortcut, playRandomCardFaceDown, revealCards, revealShortcut, stopLookingAtCards, stopLookingShortcut } from '../../actions/general/reveal-and-hide.js'
import { rotateCard } from '../../actions/general/rotate-card.js'
import { setup } from '../../actions/general/setup.js'
import { takeTurn } from '../../actions/general/take-turn.js'
import { moveCardBundle } from '../../actions/move-card-bundle/move-card-bundle.js'
import { draw, moveToDeckTop, shuffleIntoDeck, switchWithDeckTop, viewDeck } from '../../actions/zones/deck-actions.js'
import { discardAll, handAll, leaveAll, lostZoneAll, shuffleAll } from '../../actions/zones/general.js'
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from '../../actions/zones/hand-actions.js'
import { shuffleZone } from '../../actions/zones/shuffle-zone.js'
import { socket, systemState } from '../../front-end.js'
import { appendMessage } from '../../setup/chatbox/append-message.js'
import { exchangeData } from '../../setup/deck-constructor/exchange-data.js'
import { determineUsername } from '../../setup/general/determine-username.js'
import { getZone } from '../../setup/zones/get-zone.js'

export const initializeSocketEventListeners = () => {
    socket.on('joinGame', () => {
        const connectedRoom = document.getElementById('connectedRoom');
        const lobby = document.getElementById('lobby');
        const roomHeaderText = document.getElementById('roomHeaderText');
        const chatbox = document.getElementById('chatbox');
        const p2ExplanationBox = document.getElementById('p2ExplanationBox');
        roomHeaderText.textContent = 'id: ' + systemState.roomId;
        chatbox.innerHTML = '';
        connectedRoom.style.display = 'flex';
        lobby.style.display = 'none';
        p2ExplanationBox.style.display = 'none';
        if (systemState.initiator === 'opp'){
            flipBoard();
        };
        systemState.isTwoPlayer = true;
        reset('opp', true, false, false, false);
        reset('self', true, false, true, false);
        exchangeData();
        appendMessage('', systemState.p2SelfUsername + ' joined', 'announcement', false);
    });
    socket.on('roomReject', () => {
        let overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    
        let container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.textAlign = 'center';
        container.style.color = '#fff';
    
        let message = document.createElement('p');
        message.textContent = 'Room is full!';
        message.style.fontSize = '24px';
    
        container.appendChild(message);
        overlay.appendChild(container);
        document.body.appendChild(overlay);
    
        overlay.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
    });
    socket.on('connect', () => {
        if (systemState.isTwoPlayer){
            const data = {
                roomId: systemState.roomId,
                username: systemState.p2SelfUsername
            };
            socket.emit('userReconnected', data);
        };
    });
    socket.on('userReconnected', (data) => {
        appendMessage('', data.username + ' reconnected!', 'announcement', false);
    });
    socket.on('userDisconnected', (username) => {
        appendMessage('', username + ' disconnected', 'announcement', false);
    });
    socket.on('disconnect', () => {
        if(systemState.isTwoPlayer){
            appendMessage('', systemState.p2SelfUsername + ' disconnected', 'announcement', false);
        };
    });
    socket.on('exchangeData', (data) => {
        systemState.p2OppUsername = data.username;
        systemState.p2OppDeckData = data.deckData;
        appendMessage('', systemState.p2OppUsername + ' joined', 'announcement', false);
        reset('opp', true, true, true, false);
        if (data.emit){
            const data = {
                roomId: systemState.roomId,
                username : systemState.p2SelfUsername,
                deckData : systemState.selfDeckData,
                emit: false
            };
            socket.emit('exchangeData', data);
        };
    });
    socket.on('deckData', (data) => {
        systemState.p2OppDeckData = data.deckData;
        appendMessage('', determineUsername(data.user) + ' imported deck', 'announcement', false);
        reset(data.user, true, false, true, false);
    });
    socket.on('leaveRoom', (data) => {
        appendMessage('', data.username + ' left the room', 'announcement', false);
    });
    socket.on('reset', (data) => {
        reset(data.user, data.clean, data.emit, data.build, data.invalidMessage);
    });
    socket.on('setup', (data) => {
        setup(data.user, data.indices, data.emit);
    });
    socket.on('takeTurn', (data) => {
        takeTurn(data.initiator, data.user, data.emit);
    });
    socket.on('draw', (data) => {
        draw(data.initiator, data.user, data.drawAmount, data.emit);
    });
    socket.on('moveCardBundle', (data) => {
        moveCardBundle(data.initiator, data.user, data.oZoneId, data.dZoneId, data.index, data.targetIndex, data.action, data.emit)
    });
    socket.on('shuffleIntoDeck', (data) => {
        shuffleIntoDeck(data.initiator, data.user, data.zoneId, data.index, data.indices, data.emit);
    });
    socket.on('moveToDeckTop', (data) => {
        moveToDeckTop(data.initiator, data.user, data.oZoneId, data.index, data.emit);
    });
    socket.on('switchWithDeckTop', (data) => {
        switchWithDeckTop(data.initiator, data.user, data.oZoneId, data.index, data.emit);
    });
    socket.on('viewDeck', (data) => {
        viewDeck(data.initiator, data.user, data.viewAmount, data.top, data.selectedDeckCount, data.targetIsOpp, data.emit);
    });
    socket.on('shuffleAll', (data) => {
        shuffleAll(data.initiator, data.user, data.zoneId, data.indices, data.emit);
    });
    socket.on('discardAll', (data) => {
        discardAll(data.initiator, data.user, data.zoneId, data.emit);
    });
    socket.on('lostZoneAll', (data) => {
        lostZoneAll(data.initiator, data.user, data.zoneId, data.emit);
    });
    socket.on('handAll', (data) => {
        handAll(data.initiator, data.user, data.zoneId, data.emit);
    });
    socket.on('leaveAll', (data) => {
        leaveAll(data.initiator, data.user, data.oZoneId, data.emit);
    });
    socket.on('discardAndDraw', (data) => {
        discardAndDraw(data.initiator, data.user, data.drawAmount, data.emit);
    });
    socket.on('shuffleAndDraw', (data) => {
        shuffleAndDraw(data.initiator, data.user, data.drawAmount, data.indices, data.emit);
    });
    socket.on('shuffleBottomAndDraw', (data) => {
        shuffleBottomAndDraw(data.initiator, data.user, data.drawAmount, data.indices, data.emit);
    });
    socket.on('shuffleZone', (data) => {
        shuffleZone(data.initiator, data.user, data.zoneId, data.indices, data.message, data.emit);
    });
    socket.on('useAbility', (data) => {
        useAbility(data.initiator, data.user, data.zoneId, data.index, data.emit);
    });
    socket.on('removeAbilityCounter', (data) => {
        const targetCard = getZone(data.user, data.zoneId).array[data.index];
        targetCard.image.abilityCounter.handleRemove(data.emit);
    });
    socket.on('addDamageCounter', (data) => {
        addDamageCounter(data.user, data.zoneId, data.index, data.damageAmount, data.emit);
    });
    socket.on('updateDamageCounter', (data) => {
        const damageCounter = getZone(data.user, data.zoneId).array[data.index].image.damageCounter;
        damageCounter.textContent = data.damageAmount;
    });
    socket.on('removeDamageCounter', (data) => {
        const damageCounter = getZone(data.user, data.zoneId).array[data.index].image.damageCounter;
        damageCounter.textContent = '0';
        damageCounter.handleRemove();
    });
    socket.on('addSpecialCondition', (data) => {
        addSpecialCondition(data.user, data.zoneId, data.index, data.emit);
    });
    socket.on('updateSpecialCondition', (data) => {
        const specialCondition = getZone(data.user, data.zoneId).array[data.index].image.specialCondition;
        specialCondition.textContent = data.textContent;
        specialCondition.handleColor(data.emit);
    });
    socket.on('removeSpecialCondition', (data) => {
        const specialCondition = getZone(data.user, data.zoneId).array[data.index].image.specialCondition;
        specialCondition.textContent = '0';
        specialCondition.handleRemove();
    });
    socket.on('discardBoard', (data) => {
        discardBoard(data.initiator, data.user, data.message, data.emit);
    });
    socket.on('handBoard', (data) => {
        handBoard(data.initiator, data.user, data.message, data.emit);
    });
    socket.on('shuffleBoard', (data) => {
        shuffleBoard(data.initiator, data.user, data.message, data.indices, data.emit);
    });
    socket.on('lostZoneBoard', (data) => {
        lostZoneBoard(data.initiator, data.user, data.message, data.emit);
    });
    socket.on('lookAtCards', (data) => {
        lookAtCards(data.initiator, data.user, data.zoneId, data.emit);
    });
    socket.on('stopLookingAtCards', (data) => {
        stopLookingAtCards(data.initiator, data.user, data.zoneId, data.message, data.emit);
    });
    socket.on('revealCards', (data) => {
        revealCards(data.initiator, data.user, data.zoneId, data.emit);
    });
    socket.on('hideCards', (data) => {
        hideCards(data.initiator, data.user, data.zoneId, data.emit);
    });
    socket.on('revealShortcut', (data) => {
        revealShortcut(data.initiator, data.user, data.zoneId, data.index, data.message, data.emit);
    });
    socket.on('hideShortcut', (data) => {
        hideShortcut(data.initiator, data.user, data.zoneId, data.index, data.message, data.emit);
    });
    socket.on('lookShortcut', (data) => {
        lookShortcut(data.initiator, data.user, data.zoneId, data.index, data.emit);
    });
    socket.on('stopLookingShortcut', (data) => {
        stopLookingShortcut(data.initiator, data.user, data.zoneId, data.index, data.emit);
    });
    socket.on('playRandomCardFaceDown', (data) => {
        playRandomCardFaceDown(data.initiator, data.user, data.randomIndex, data.emit);
    });
    socket.on('rotateCard', (data) => {
        rotateCard(data.user, data.zoneId, data.index, data.single, data.emit);
    });
    socket.on('changeType', (data) => {
        changeType(data.initiator, data.user, data.zoneId, data.index, data.type, data.emit);
    });
    socket.on('attack', (data) => {
        attack(data.initiator, data.emit);
    });
    socket.on('pass', (data) => {
        pass(data.initiator, data.emit);
    });
    socket.on('VSTARGXFunction', (data) => {
        VSTARGXFunction(data.user, data.type, data.emit)
    });
    socket.on('appendMessage', (data) => {
        appendMessage(data.user, data.message, data.type, data.emit);
    });
}