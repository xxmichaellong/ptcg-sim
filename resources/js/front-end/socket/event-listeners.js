import { connectedRoom, lobby, p1, roomIdInput, socket, p2SelfUsername, p2OppUsername } from '../front-end.js'
import { appendMessage } from '../setup/chatbox/messages.js'
import { moveCard } from '../actions/general/move-card.js'
import { takeTurn } from '../actions/general/take-turn.js'
import { setup } from '../actions/general/setup.js'
import { reset } from '../actions/general/reset.js'
import { flipCoin } from '../actions/general/flip-coin.js'
import { VSTARGXFunction } from '../actions/general/VSTAR-GX.js'

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
        appendMessage('', otherPlayerUsername[0] + ' is here!', 'announcement');
    };
    appendMessage('', p2SelfUsername[0] + ' joined', 'announcement');
});
socket.on('joinMessage', (otherPlayerUsername) => {
    p2OppUsername[0] = otherPlayerUsername;
    appendMessage('', otherPlayerUsername + ' joined', 'announcement');
});
socket.on('leaveGameMessage', (otherPlayerUsername) => {
    appendMessage('', otherPlayerUsername + ' left', 'announcement');
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
socket.on('setup', (data) => {
    setup(data.user, data.indices, data.received);
});
socket.on('reset', (data) => {
    reset(data.user, data.clean, data.received);
});
socket.on('takeTurn', (data) => {
    takeTurn(data.user, data.received);
});
socket.on('flipCoin', (data) => {
    flipCoin(data.user, data.result, data.received);
});
socket.on('VSTARGXFunction', (data) => {
    VSTARGXFunction(data.user, data.type, data.received)
});
socket.on('appendMessage', (data) => {
    appendMessage(data.user, data.message, data.type);
});




socket.on('shuffleContainer', (user, location, location_html, indices) => {
    shuffleContainer(user, location, location_html, indices);
});
socket.on('discardAll', (user, discardAmount) => {
    discardAll(user, discardAmount);
});
socket.on('discardAndDraw', (discardAmount, drawAmount) => {
    discardAndDraw('opp', discardAmount, drawAmount);
});
socket.on('shuffleAndDraw', (shuffleAmount, drawAmount, indices) => {
    shuffleAndDraw('opp', shuffleAmount, drawAmount, indices);
});
socket.on('shuffleBottomAndDraw', (shuffleAmount, drawAmount, indices) => {
    shuffleBottomAndDraw('opp', shuffleAmount, drawAmount, indices);
});
socket.on('draw', (drawAmount) => {
    draw('opp', drawAmount);
});
socket.on('viewDeck', (user, viewAmount, targetOpp, top, deckCount) => {
    viewDeck(user, viewAmount, targetOpp, top, deckCount);
});
socket.on('addDamageCounter', (user, location, container, index) => {
    addDamageCounter(user, location, container, index);
});

socket.on('updateDamageCounter', (user, location, index, textContent) => {
    let damageCounter = stringToVariable(user, location).cards[index].image.damageCounter;
    damageCounter.textContent = textContent;
});

socket.on('removeDamageCounter', (user, location, index) => {
    const targetCard = stringToVariable(user, location).cards[index];

    targetCard.image.damageCounter.textContent = '0';
    targetCard.image.damageCounter.handleRemove();
});

socket.on('addSpecialCondition', (user, location, container, index) => {
    addSpecialCondition(user, location, container, index);
});

socket.on('updateSpecialCondition', (user, location, index, textContent) => {
    let specialCondition = stringToVariable(user, location).cards[index].image.specialCondition;
    specialCondition.textContent = textContent;
    specialCondition.handleColour();
});

socket.on('removeSpecialCondition', (user, location, index) => {
    const targetCard = stringToVariable(user, location).cards[index];

    targetCard.image.specialCondition.textContent = '0';
    targetCard.image.specialCondition.handleRemove();
});


socket.on('moveCard', (user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex) => {
    moveCard(user, oLocation, oLocation_html, mLocation, mLocation_html, index, targetIndex);
});