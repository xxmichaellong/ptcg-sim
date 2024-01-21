import { attack, pass } from '../../actions/chat-buttons/chat-buttons.js'
import { removeAbilityCounter } from '../../actions/counters/ability-counter.js'
import { addDamageCounter, removeDamageCounter, updateDamageCounter } from '../../actions/counters/damage-counter.js'
import { addSpecialCondition, removeSpecialCondition, updateSpecialCondition } from '../../actions/counters/special-condition.js'
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
import { loadDeckData } from '../../setup/deck-constructor/import.js'
import { acceptAction } from '../../setup/general/accept-action.js'
import { catchUpActions } from '../../setup/general/catch-up-actions.js'
import { cleanActionData } from '../../setup/general/clean-action-data.js'
import { resyncActions } from '../../setup/general/resync-actions.js'
import { spectatorJoin } from '../../setup/spectator/spectator-join.js'

let syncCheckInterval;
let spectatorActionInterval;
export const removeSyncIntervals = () => {
    clearInterval(syncCheckInterval);
    clearInterval(spectatorActionInterval);
}
export const initializeSocketEventListeners = () => {
    socket.on('joinGame', () => {
        const connectedRoom = document.getElementById('connectedRoom');
        const lobby = document.getElementById('lobby');
        const roomHeaderText = document.getElementById('roomHeaderText');
        const chatbox = document.getElementById('chatbox');
        const p2ExplanationBox = document.getElementById('p2ExplanationBox');
        const flipBoardButton = document.getElementById('flipBoardButton');
        roomHeaderText.textContent = 'id: ' + systemState.roomId;
        chatbox.innerHTML = '';
        connectedRoom.style.display = 'flex';
        lobby.style.display = 'none';
        p2ExplanationBox.style.display = 'none';
        flipBoardButton.style.display = 'none';
        if (systemState.initiator === 'opp'){
            flipBoard();
        };
        systemState.isTwoPlayer = true;
        cleanActionData('self');
        cleanActionData('opp');
        reset('opp', true, false, false, false);
        exchangeData('self', systemState.p2SelfUsername, systemState.selfDeckData, systemState.cardBackSrc, document.getElementById('coachingModeCheckbox').checked);

        //initialize sync checker, which will routinely make sure game are synced
        syncCheckInterval = setInterval(() => {
            if (systemState.isTwoPlayer){
                const data = {
                    roomId: systemState.roomId,
                    counter: systemState.selfCounter
                };
                socket.emit('syncCheck', data);
            };
        }, 3000);

        spectatorActionInterval = setInterval(() => {
            if (systemState.isTwoPlayer){
                const data = {
                    selfUsername: systemState.p2SelfUsername,
                    oppUsername: systemState.p2OppUsername,
                    roomId: systemState.roomId,
                    spectatorActionData: systemState.spectatorActionData,
                    socketId: socket.id,
                };
                socket.emit('spectatorActionData', data);
            };
        }, 1000);
    });
    socket.on('spectatorJoin', () => {
        spectatorJoin();
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
        message.innerHTML = 'Room is full.<br>Enable spectator mode to watch the game.';
        message.style.fontSize = '24px';
    
        container.appendChild(message);
        overlay.appendChild(container);
        document.body.appendChild(overlay);
    
        overlay.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
    });
    socket.on('connect', () => {
        const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
        if (systemState.isTwoPlayer){
            const data = {
                roomId: systemState.roomId,
                username: systemState.p2SelfUsername,
                notSpectator: notSpectator
            };
            socket.emit('userReconnected', data);
            if (!notSpectator){
                appendMessage('', systemState.spectatorUsername + ' reconnected!', 'announcement', false);
            };
        };
    });
    socket.on('userReconnected', (data) => {
        appendMessage('', data.username + ' reconnected!', 'announcement', false);
    });
    socket.on('userDisconnected', (username) => {
        appendMessage('', username + ' disconnected', 'announcement', false);
    });
    socket.on('disconnect', () => {
        if (systemState.isTwoPlayer){
            const isSpectator = systemState.isTwoPlayer && document.getElementById('spectatorModeCheckbox').checked;
            const username = isSpectator ? systemState.spectatorUsername : systemState.p2SelfUsername;
            appendMessage('', username + ' disconnected', 'announcement', false);
        };
    });
    socket.on('leaveRoom', (data) => {
        if (!data.isSpectator){
            cleanActionData('opp');
        };
        appendMessage('', data.username + ' left the room', 'announcement', false);
    });
    socket.on('appendMessage', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';   
        };
        appendMessage(data.user, data.message, data.type, data.emit);
    });
    socket.on('requestAction', (data) => {
        const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
        if (notSpectator && data.counter === systemState.selfCounter){
            acceptAction('self', data.action, data.parameters);
        };
    });
    socket.on('pushAction', (data) => {
        const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
        if (notSpectator){
            if (data.action === 'exchangeData'){
                cleanActionData('opp');
            };
            if (data.counter === (parseInt(systemState.oppCounter) + 1)){
                systemState.oppCounter ++;
                systemState.spectatorActionData.push({user: 'opp', action: data.action, parameters: data.parameters});
                acceptAction('opp', data.action, data.parameters);
            } else if (data.counter > (parseInt(systemState.oppCounter) + 1)){
                const data = {
                    roomId: systemState.roomId,
                    counter: systemState.oppCounter,
                };
                socket.emit('resyncActions', data);
            };
        };
    });
    socket.on('resyncActions', () => {
        const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
        if (notSpectator){
            resyncActions();
        };
    });
    socket.on('catchUpActions', (data) => {
        const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
        if (notSpectator){
            catchUpActions(data.actionData);
        };
    });
    socket.on('syncCheck', (data) => {
        const notSpectator = !(document.getElementById('spectatorModeCheckbox').checked && systemState.isTwoPlayer);
        if (notSpectator && data.counter >= (parseInt(systemState.oppCounter) + 1)){
            const data = {
                roomId: systemState.roomId,
                counter: systemState.oppCounter,
            };
            socket.emit('resyncActions', data);
        };
    });
    // socket.on('exchangeData', (data) => {
    //     exchangeData(data.user, data.username, data.deckData, data.emit);
    // });
    // socket.on('loadDeckData', (data) => {
    //     loadDeckData(data.user, data.deckData, data.emit);
    // });
    // socket.on('reset', (data) => {
    //     reset(data.user, data.clean, data.build, data.invalidMessage, data.emit);
    // });
    // socket.on('setup', (data) => {
    //     setup(data.user, data.indices, data.emit);
    // });
    // socket.on('takeTurn', (data) => {
    //     takeTurn(data.user, data.initiator, data.emit);
    // });
    // socket.on('draw', (data) => {
    //     draw(data.user, data.initiator, data.drawAmount, data.emit);
    // });
    // socket.on('moveCardBundle', (data) => {
    //     moveCardBundle(data.user, data.initiator, data.oZoneId, data.dZoneId, data.index, data.targetIndex, data.action, data.emit)
    // });
    // socket.on('shuffleIntoDeck', (data) => {
    //     shuffleIntoDeck(data.user, data.initiator, data.zoneId, data.index, data.indices, data.emit);
    // });
    // socket.on('moveToDeckTop', (data) => {
    //     moveToDeckTop(data.user, data.initiator, data.oZoneId, data.index, data.emit);
    // });
    // socket.on('switchWithDeckTop', (data) => {
    //     switchWithDeckTop(data.user, data.initiator, data.oZoneId, data.index, data.emit);
    // });
    // socket.on('viewDeck', (data) => {
    //     viewDeck(data.user, data.initiator, data.viewAmount, data.top, data.selectedDeckCount, data.targetIsOpp, data.emit);
    // });
    // socket.on('shuffleAll', (data) => {
    //     shuffleAll(data.user, data.initiator, data.zoneId, data.indices, data.emit);
    // });
    // socket.on('discardAll', (data) => {
    //     discardAll(data.user, data.initiator, data.zoneId, data.emit);
    // });
    // socket.on('lostZoneAll', (data) => {
    //     lostZoneAll(data.user, data.initiator, data.zoneId, data.emit);
    // });
    // socket.on('handAll', (data) => {
    //     handAll(data.user, data.initiator, data.zoneId, data.emit);
    // });
    // socket.on('leaveAll', (data) => {
    //     leaveAll(data.user, data.initiator, data.oZoneId, data.emit);
    // });
    // socket.on('discardAndDraw', (data) => {
    //     discardAndDraw(data.user, data.initiator, data.drawAmount, data.emit);
    // });
    // socket.on('shuffleAndDraw', (data) => {
    //     shuffleAndDraw(data.user, data.initiator, data.drawAmount, data.indices, data.emit);
    // });
    // socket.on('shuffleBottomAndDraw', (data) => {
    //     shuffleBottomAndDraw(data.user, data.initiator, data.drawAmount, data.indices, data.emit);
    // });
    // socket.on('shuffleZone', (data) => {
    //     shuffleZone(data.user, data.initiator, data.zoneId, data.indices, data.message, data.emit);
    // });
    // socket.on('useAbility', (data) => {
    //     useAbility(data.user, data.initiator, data.zoneId, data.index, data.emit);
    // });
    // socket.on('removeAbilityCounter', (data) => {
    //     removeAbilityCounter(data.user, data.zoneId, data.index, data.emit);
    // });
    // socket.on('addDamageCounter', (data) => {
    //     addDamageCounter(data.user, data.zoneId, data.index, data.damageAmount, data.emit);
    // });
    // socket.on('updateDamageCounter', (data) => {
    //     updateDamageCounter(data.user, data.zoneId, data.index, data.damageAmount, data.emit);
    // });
    // socket.on('removeDamageCounter', (data) => {
    //     removeDamageCounter(data.user, data.zoneId, data.index, data.emit);
    // });
    // socket.on('addSpecialCondition', (data) => {
    //     addSpecialCondition(data.user, data.zoneId, data.index, data.emit);
    // });
    // socket.on('updateSpecialCondition', (data) => {
    //     updateSpecialCondition(data.user, data.zoneId, data.index, data.textContent, data.emit);
    // });
    // socket.on('removeSpecialCondition', (data) => {
    //     removeSpecialCondition(data.user, data.zoneId, data.index, data.emit);
    // });
    // socket.on('discardBoard', (data) => {
    //     discardBoard(data.user, data.initiator, data.message, data.emit);
    // });
    // socket.on('handBoard', (data) => {
    //     handBoard(data.user, data.initiator, data.message, data.emit);
    // });
    // socket.on('shuffleBoard', (data) => {
    //     shuffleBoard(data.user, data.initiator, data.message, data.indices, data.emit);
    // });
    // socket.on('lostZoneBoard', (data) => {
    //     lostZoneBoard(data.user, data.initiator, data.message, data.emit);
    // });
    socket.on('lookAtCards', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        lookAtCards(data.user, data.initiator, data.zoneId, data.message, data.emit);
    });
    socket.on('stopLookingAtCards', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        stopLookingAtCards(data.user, data.initiator, data.zoneId, data.message, data.emit);
    });
    socket.on('revealCards', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        revealCards(data.user, data.initiator, data.zoneId, data.emit);
    });
    socket.on('hideCards', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        hideCards(data.user, data.initiator, data.zoneId, data.emit);
    });
    socket.on('revealShortcut', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        revealShortcut(data.user, data.initiator, data.zoneId, data.index, data.message, data.emit);
    });
    socket.on('hideShortcut', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        hideShortcut(data.user, data.initiator, data.zoneId, data.index, data.message, data.emit);
    });
    socket.on('lookShortcut', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        lookShortcut(data.user, data.initiator, data.zoneId, data.index, data.emit);
    });
    socket.on('stopLookingShortcut', (data) => {
        if (data.socketId === systemState.spectatorId){
            data.user = data.user === 'self' ? 'opp' : 'self';
            data.initiator = data.initiator === 'self' ? 'opp' : 'self';   
        };
        stopLookingShortcut(data.user, data.initiator, data.zoneId, data.index, data.emit);
    });
    // socket.on('playRandomCardFaceDown', (data) => {
    //     playRandomCardFaceDown(data.user, data.initiator, data.randomIndex, data.emit);
    // });
    // socket.on('rotateCard', (data) => {
    //     rotateCard(data.user, data.zoneId, data.index, data.single, data.emit);
    // });
    // socket.on('changeType', (data) => {
    //     changeType(data.user, data.initiator, data.zoneId, data.index, data.type, data.emit);
    // });
    // socket.on('attack', (data) => {
    //     attack(data.user, data.emit);
    // });
    // socket.on('pass', (data) => {
    //     pass(data.user, data.emit);
    // });
    // socket.on('VSTARGXFunction', (data) => {
    //     VSTARGXFunction(data.user, data.type, data.emit)
    // });
}