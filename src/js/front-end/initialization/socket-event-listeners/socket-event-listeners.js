import { addAbilityCounter } from '../../actions/counters/ability-counter.js'
import { addDamageCounter } from '../../actions/counters/damage-counter.js'
import { resetCounters } from '../../actions/counters/reset-ability-counters.js'
import { addSpecialCondition } from '../../actions/counters/special-condition.js'
import { VSTARGXFunction } from '../../actions/general/VSTAR-GX.js'
import { changeType } from '../../actions/general/change-type.js'
import { flipBoard } from '../../actions/general/flip-board.js'
import { reset } from '../../actions/general/reset.js'
import { hideShortcut, revealShortcut, stopLookingShortcut } from '../../actions/general/reveal-and-hide.js'
import { rotateCard } from '../../actions/general/rotate-card.js'
import { takeTurn } from '../../actions/general/take-turn.js'
import { moveCard } from '../../actions/move-card-logic/move-card.js'
import { viewDeck } from '../../actions/zones/deck-actions.js'
import { shuffleZone } from '../../actions/zones/shuffle-zone.js'
import { socket, systemState } from '../../front-end.js'
import { appendMessage } from '../../setup/chatbox/messages.js'
import { exchangeData } from '../../setup/deck-constructor/fetch-opp-data.js'
import { determineUsername } from '../../setup/general/determine-username.js'
import { getZone } from '../../setup/zones/get-zone.js'

export const initializeSocketEventListeners = () => {
    socket.on('joinGame', () => {
        const connectedRoom = document.getElementById('connectedRoom');
        const lobby = document.getElementById('lobby');
        const roomHeaderText = document.getElementById('roomHeaderText');
        const chatbox = document.getElementById('chatbox');
        const p2ExplanationBox = document.getElementById('p2ExplanationBox');

        systemState.isTwoPlayer = true;
        reset('opp', true, false, false);
        reset('self', true, true, true, false);
        roomHeaderText.textContent = 'id: ' + systemState.roomId;
        chatbox.innerHTML = '';
        if (systemState.pov.user === 'opp'){
            flipBoard();
        };
        connectedRoom.style.display = 'flex';
        lobby.style.display = 'none';
        p2ExplanationBox.style.display = 'none';
        exchangeData()
            .then(() => {
                reset('opp', true, true, true, false);
                appendMessage('opp', systemState.p2OppUsername + ' is here!', 'announcement', false);
            })
            .catch((error) => {
                console.log(error);
            });
        appendMessage('self', systemState.p2SelfUsername + ' joined', 'announcement', false);
    });

    socket.on('leaveGameMessage', (otherPlayerUsername) => {
        appendMessage('opp', otherPlayerUsername + ' left', 'announcement', false);
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
    
    socket.on('exchangeData', (data) => {
        systemState.p2OppUsername = data.username;
        systemState.p2OppDeckData = data.deckData;
        appendMessage('opp', systemState.p2OppUsername + ' joined', 'announcement', false);
        reset('opp', true, true, true, false);
        const exchangeData = {
            roomId : systemState.roomId,
            username : systemState.p2SelfUsername,
            deckData : systemState.selfDeckData,
        };
        socket.emit('sentData', exchangeData);
    });

    socket.on('deckData', (data) => {
        systemState.p2OppDeckData = data.deckData;
        appendMessage(data.user, determineUsername(data.user) + ' imported deck', 'announcement', false);
        reset(data.user, true, true, true);
    });

    socket.on('appendMessage', (data) => {
        appendMessage(data.user, data.message, data.type, data.emit);
    });

    socket.on('reset', (data) => {
        reset(data.user, data.clean, data.emit, data.build, data.invalidMessage);
    });

    socket.on('takeTurn', (data) => {
        takeTurn(data.user, data.emit);
    });

    socket.on('VSTARGXFunction', (data) => {
        VSTARGXFunction(data.user, data.type, data.emit)
    });

    socket.on('moveCard', (data) => {
        moveCard(data.user, data.oZoneId, data.dZoneId, data.index, data.targetIndex, data.emit);
    });

    socket.on('addDamageCounter', (data) => {
        addDamageCounter(data.user, data.zoneId, data.index, data.emit);
    });

    socket.on('updateDamageCounter', (data) => {
        const damageCounter = getZone(data.user, data.zoneId).array[data.index].image.damageCounter;
        damageCounter.textContent = data.textContent;
    });

    socket.on('removeDamageCounter', (data) => {
        const targetCard = getZone(data.user, data.zoneId).array[data.index];
        targetCard.image.damageCounter.textContent = '0';
        targetCard.image.damageCounter.handleRemove();
    });

    socket.on('addSpecialCondition', (data) => {
        addSpecialCondition(data.user, data.zoneId, data.index, data.emit);
    });

    socket.on('updateSpecialCondition', (data) => {
        const specialCondition = getZone(data.user, data.zoneId).array[data.index].image.specialCondition;
        specialCondition.textContent = data.textContent;
        specialCondition.handleColor();
    });

    socket.on('removeSpecialCondition', (data) => {
        const targetCard = getZone(data.user, data.zoneId).array[data.index];
        targetCard.image.specialCondition.textContent = '0';
        targetCard.image.specialCondition.handleRemove();
    });

    socket.on('addAbilityCounter', (data) => {
        addAbilityCounter(data.user, data.zoneId, data.index, data.emit);
    });

    socket.on('removeAbilityCounter', (data) => {
        const targetCard = getZone(data.user, data.zoneId).array[data.index];
        targetCard.image.abilityCounter.handleRemove(data.emit);
    });

    socket.on('resetCounters', (data) => {
        resetCounters(data.emit);
    });

    socket.on('shuffleZone', (data) => {
        shuffleZone(data.user, data.zoneId, data.indices, data.emit);
    });

    socket.on('viewDeck', (data) => {
        viewDeck(data.user, data.viewAmount, data.top, data.selectedDeckCount, data.targetOpp, data.emit);
    });

    socket.on('rotateCard', (data) => {
        rotateCard(data.user, data.zoneId, data.index, data.single, data.emit);
    });

    socket.on('revealShortcut', (data) => {
        revealShortcut(data.user, data.zoneId, data.index, data.message, data.emit);
    });

    socket.on('hideShortcut', (data) => {
        hideShortcut(data.user, data.zoneId, data.index, data.message, data.emit);
    });

    socket.on('stopLookingShortcut', (data) => {
        stopLookingShortcut(data.user, data.zoneId, data.index);
    });

    socket.on('faceDown', (data) => {
        const card = getZone(data.user, data.zoneId).array[data.index];
        card.image.faceDown = true;
    });
    
    socket.on('changeType', (data) => {
        changeType(data.user, data.zoneId, data.index, data.type, data.emit);
    });
}