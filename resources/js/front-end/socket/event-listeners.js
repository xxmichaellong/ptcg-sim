import { connectedRoom, lobby, p1, roomIdInput, socket, p2SelfUsername, p2OppUsername } from '../front-end.js'
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

socket.on('generateId', (id) => {
    roomIdInput.value = id;
});
socket.on('joinGame', (otherPlayerUsername) => {
    p1[0] = false;
    connectedRoom.style.display = 'block';
    lobby.style.display = 'none';
    reset('self', true);
    reset('opp', true);
    if (otherPlayerUsername.length > 0){
        p2OppUsername[0] = otherPlayerUsername[0];
        appendMessage('', otherPlayerUsername[0] + ' is here!', 'announcement', true);
    };
    appendMessage('', p2SelfUsername[0] + ' joined', 'announcement', true);
});
socket.on('joinMessage', (otherPlayerUsername) => {
    p2OppUsername[0] = otherPlayerUsername;
    appendMessage('', otherPlayerUsername + ' joined', 'announcement', true);
});
socket.on('leaveGameMessage', (otherPlayerUsername) => {
    appendMessage('', otherPlayerUsername + ' left', 'announcement', true);
});
socket.on('roomReject', () => {
    // Create overlay
    let overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'; // Semi-transparent

    let container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '50%';
    container.style.left = '50%';
    container.style.transform = 'translate(-50%, -50%)';
    container.style.textAlign = 'center';
    container.style.color = '#fff'; // White text

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
socket.on('appendMessage', (data) => {
    appendMessage(data.user, data.message, data.type, data.received);
});
socket.on('reset', (data) => {
    reset(data.user, data.clean, data.received);
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










