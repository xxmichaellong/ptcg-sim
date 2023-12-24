import { connectedRoom, lobby, p1, roomIdInput, socket, p2SelfUsername, p2OppUsername, roomHeaderText, roomId, chatbox, POV, p2ExplanationBox } from '../front-end.js'
import { appendMessage } from '../setup/chatbox/messages.js'
import { moveCard } from '../actions/general/move-card.js'
import { takeTurn } from '../actions/general/take-turn.js'
import { reset } from '../actions/general/reset.js'
import { VSTARGXFunction } from '../actions/general/VSTAR-GX.js'
import { addDamageCounter } from '../actions/counters/damage-counter.js'
import { stringToVariable } from '../setup/containers/string-to-variable.js'
import { addSpecialCondition } from '../actions/counters/special-condition.js'
import { shuffleContainer } from '../actions/container/shuffle-container.js'
import { viewDeck } from '../actions/container/deck-actions.js'
import { addAbilityCounter } from '../actions/counters/ability-counter.js'
import { resetCounters } from '../actions/counters/reset-ability-counters.js'
import { flipBoard } from '../actions/general/flip-board.js'
import { exchangeData, p2DeckData } from './fetch-opp-data.js'
import { mainDeckData } from '../setup/deck-constructor/import.js'
import { determineUsername } from '../setup/general/determine-username.js'

socket.on('generateId', (id) => {
    roomIdInput.value = id;
});
socket.on('joinGame', () => {
    p1[0] = false;
    reset('opp', true, true, false);
    reset('self', true, false, true, false);
    roomHeaderText.textContent = 'id: ' + roomId[0];
    chatbox.innerHTML = '';
    if (POV.user === 'opp'){
        flipBoard();
    };
    connectedRoom.style.display = 'flex';
    lobby.style.display = 'none';
    p2ExplanationBox.style.display = 'none';
    exchangeData()
        .then(() => {
            reset('opp', true, false, true, false);
            appendMessage('opp', p2OppUsername[0] + ' is here!', 'announcement', true);
        })
        .catch((error) => {
            console.log(error);
        });
    appendMessage('self', p2SelfUsername[0] + ' joined', 'announcement', true);
});
socket.on('leaveGameMessage', (otherPlayerUsername) => {
    appendMessage('opp', otherPlayerUsername + ' left', 'announcement', true);
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
    p2OppUsername[0] = data.username;
    p2DeckData[0] = data.deckData;
    appendMessage('opp', p2OppUsername[0] + ' joined', 'announcement', true);
    reset('opp', true, false, true, false);
    const exchangeData = {
        roomId : roomId,
        username : p2SelfUsername,
        deckData : mainDeckData[0]
    };
    socket.emit('sentData', exchangeData);
});
socket.on('deckData', (data) => {
    p2DeckData[0] = data.deckData;
    appendMessage(data.user, determineUsername(data.user) + ' imported deck', 'announcement', true);
    reset(data.user, true, false, true);
})
socket.on('appendMessage', (data) => {
    appendMessage(data.user, data.message, data.type, data.received);
});
socket.on('reset', (data) => {
    reset(data.user, data.clean, data.received, data.build, data.invalidMessage);
});
socket.on('takeTurn', (data) => {
    takeTurn(data.user, data.received);
});
socket.on('VSTARGXFunction', (data) => {
    VSTARGXFunction(data.user, data.type, data.received)
});
socket.on('moveCard', (data) => {
    moveCard(data.user, data.oLocation, data.oLocation_html, data.mLocation, data.mLocation_html, data.index, data.targetIndex, data.received);
});
socket.on('addDamageCounter', (data) => {
    addDamageCounter(data.user, data.location, data.container, data.index, data.received);
});
socket.on('updateDamageCounter', (data) => {
    const damageCounter = stringToVariable(data.user, data.location).cards[data.index].image.damageCounter;
    damageCounter.textContent = data.textContent;
});
socket.on('removeDamageCounter', (data) => {
    const targetCard = stringToVariable(data.user, data.location).cards[data.index];
    targetCard.image.damageCounter.textContent = '0';
    targetCard.image.damageCounter.handleRemove();
});
socket.on('addSpecialCondition', (data) => {
    addSpecialCondition(data.user, data.location, data.container, data.index, data.received);
});
socket.on('updateSpecialCondition', (data) => {
    const specialCondition = stringToVariable(data.user, data.location).cards[data.index].image.specialCondition;
    specialCondition.textContent = data.textContent;
    specialCondition.handleColour();
});
socket.on('removeSpecialCondition', (data) => {
    const targetCard = stringToVariable(data.user, data.location).cards[data.index];
    targetCard.image.specialCondition.textContent = '0';
    targetCard.image.specialCondition.handleRemove();
});
socket.on('addAbilityCounter', (data) => {
    addAbilityCounter(data.user, data.location, data.container, data.index, data.received);
});
socket.on('removeAbilityCounter', (data) => {
    const targetCard = stringToVariable(data.user, data.location).cards[data.index];
    targetCard.image.abilityCounter.handleRemove();
});
socket.on('resetCounters', (data) => {
    resetCounters(data.received);
});
socket.on('shuffleContainer', (data) => {
    shuffleContainer(data.user, data.location, data.location_html, data.indices, data.received);
});
socket.on('viewDeck', (data) => {
    viewDeck(data.user, data.viewAmount, data.top, data.deckCount, data.targetOpp, data.received);
});










