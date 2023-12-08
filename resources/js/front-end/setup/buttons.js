import {sCard, prizes_html, lostzone_html, discard_html, prizes, deck_html, hand, deck, viewCards, attachedCardPopup } from "./self-initialization.js";
import { drawHand } from "../general-actions/hand/draw-hand.js";
import { shuffleContainer } from "../general-actions/shuffle-container.js";
import { revealCards, hideCards } from "../general-actions/reveal-and-hide.js"; 
import { selfContainersDocument } from "./self-initialization.js";
import { oppAttachedCardPopup, oppContainersDocument, oppDeck, oppDeck_html, oppDiscard_html, oppHand, oppHand_html, oppLostzone_html, oppPrizes, oppViewCards } from "./opp-initialization.js";
import { addDamageCounter } from "../general-actions/damage-counter.js";
import { variableToString } from "./string-to-variable.js";
import { socket } from "./socket.js";
import { addSpecialCondition } from "../general-actions/special-condition.js";
import { roomId, username } from "../lobby/generate-id.js";
import { discardAndDraw, shuffleAndDraw, shuffleBottomAndDraw } from "../general-actions/hand/discard-and-draw.js";
import { draw, moveToDeckTop, shuffleIntoDeck, viewDeck } from "../general-actions/deck-actions.js";
import { moveCard } from "../image-logic/move-card.js";
import { shuffleIndices } from "./shuffle.js";
import { discardAll } from "../general-actions/discard-all.js";
import { pvpChatbox } from "../front-end.js";

// Draw a Hand
const drawHandButton = document.getElementById('drawHandButton');
drawHandButton.addEventListener('click', function(){drawHand('self')});

const pvpDrawHandButton = document.getElementById('pvpDrawHandButton');
pvpDrawHandButton.addEventListener('click', function(){drawHand('self')});

const shuffleDeckButton = document.getElementById('shuffleDeckButton');
const shufflePrizesButton = document.getElementById('shufflePrizesButton');

shuffleDeckButton.addEventListener('click', function(){
    let deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;
    const indices = shuffleIndices(deckCount);
    shuffleContainer(sCard.user, 'deck', 'deck_html', indices);
    socket.emit('shuffleContainer', roomId, sCard.oUser, 'deck', 'deck_html', indices);
});
shufflePrizesButton.addEventListener('click', function(){
    let prizesCount = sCard.user === 'self' ? prizes.count : oppPrizes.count;
    const indices = shuffleIndices(prizesCount);
    shuffleContainer(sCard.user, 'prizes', 'prizes_html', indices);
    socket.emit('shuffleContainer', roomId, sCard.oUser, 'prizes', 'prizes_html', indices);
});

// Get the modal and image elements
const closeDeckDisplayButton = selfContainersDocument.getElementById('closeDeckDisplayButton');
// Function to close the modal
closeDeckDisplayButton.addEventListener('click', () => {
    deck_html.style.display = 'none';
});
const closeLostzoneDisplayButton = selfContainersDocument.getElementById('closeLostzoneDisplayButton');
closeLostzoneDisplayButton.addEventListener('click', () => {
    lostzone_html.style.display = 'none';
});
const closeDiscardDisplayButton = selfContainersDocument.getElementById('closeDiscardDisplayButton');
closeDiscardDisplayButton.addEventListener('click', () => {
    discard_html.style.display = 'none';
});

// Reveal prizes
const revealPrizesButton = document.getElementById('revealPrizesButton');
revealPrizesButton.addEventListener('click', function(){revealCards(prizes, prizes_html)});
// Hide prizes
const hidePrizesButton = document.getElementById('hidePrizesButton');
hidePrizesButton.addEventListener('click', function(){hideCards(prizes, prizes_html)});

/// buttons on the opp side
// Get the modal and image elements
const closeOppLostzoneDisplayButton = oppContainersDocument.getElementById('closeLostzoneDisplayButton');
// Function to close the modal
closeOppLostzoneDisplayButton.addEventListener('click', () => {
    oppLostzone_html.style.display = 'none';
});
// Get the modal and image elements
const closeOppDiscardDisplayButton = oppContainersDocument.getElementById('closeDiscardDisplayButton');
closeOppDiscardDisplayButton.addEventListener('click', () => {
    oppDiscard_html.style.display = 'none';
});

const closeOppDeckDisplayButton = oppContainersDocument.getElementById('closeDeckDisplayButton');
closeOppDeckDisplayButton.addEventListener('click', () => {
    oppDeck_html.style.display = 'none';
});

const revealOppHandButton = document.getElementById('revealOppHandButton');
revealOppHandButton.addEventListener('click', () => revealCards(oppHand, oppHand_html));
const hideOppHandButton = document.getElementById('hideOppHandButton');
hideOppHandButton.addEventListener('click', () => hideCards(oppHand, oppHand_html));

const damageCounterButton = document.getElementById('damageCounterButton');
damageCounterButton.addEventListener('click', function(){
    addDamageCounter(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
    socket.emit('addDamageCounter', roomId, sCard.oUser, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
});

const specialConditionButton = document.getElementById('specialConditionButton');
specialConditionButton.addEventListener('click', function(){
    addSpecialCondition(sCard.user, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
    socket.emit('addSpecialCondition', roomId, sCard.oUser, variableToString(sCard.user, sCard.location), variableToString(sCard.user, sCard.container), sCard.index)
});

const flipCoinButton = document.getElementById('flipCoinButton');
flipCoinButton.addEventListener('click', () => {
    const randomValue = Math.random();
    const coinFlipResult = randomValue < 0.5 ? "heads" : "tails";
    const message = username + " flipped " + coinFlipResult;

    const p = document.createElement('p');
    p.className = 'announcement';
    p.style.backgroundColor = 'grey';
    p.textContent = message;
    pvpChatbox.appendChild(p);
    pvpChatbox.scrollTop = pvpChatbox.scrollHeight;

    socket.emit('generalMessage', roomId, message);
});

const vSTARButton = document.getElementById('vSTARButton');
vSTARButton.addEventListener('click', () => {
    const p = document.createElement('p');
    p.className = 'announcement';
    p.style.backgroundColor = 'grey';
    p.textContent = username + ' used their VSTAR!';
    pvpChatbox.appendChild(p);
    pvpChatbox.scrollTop = pvpChatbox.scrollHeight;

    socket.emit('generalMessage', roomId, p.textContent);
});

const discardHandButton = document.getElementById('discardHandButton');
discardHandButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, deck.count);
        socket.emit('discardAndDraw', roomId, hand.count, drawAmount);
        discardAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

const shuffleHandButton = document.getElementById('shuffleHandButton');
shuffleHandButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (deck.count + hand.count));
        shuffleAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

const shuffleHandBottomButton = document.getElementById('shuffleHandBottomButton');
shuffleHandBottomButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, (deck.count + hand.count));
        shuffleBottomAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

const drawButton = document.getElementById('drawButton');
drawButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Draw how many cards?', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0){
        drawAmount = Math.min(drawAmount, deck.count);
        draw('self', drawAmount);
        socket.emit('draw', roomId, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

function handleViewButtonClick(top){
    let viewAmount;
    const userInput = window.prompt('How many cards do you want to look at?', '1');
    viewAmount = parseInt(userInput);

    const deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;
    const targetOpp = sCard.user === 'opp';

    if (!isNaN(viewAmount) && viewAmount >= 1){
        viewAmount = Math.min(viewAmount, deckCount);
        viewDeck(sCard.user, viewAmount, targetOpp, top, deckCount);
        socket.emit('viewDeck', roomId, sCard.oUser, viewAmount, targetOpp, top, deckCount);
    } else {
        window.alert('Please enter a valid number for the view amount.');
    }
}

const viewTopButton = document.getElementById('viewTopButton');
viewTopButton.addEventListener('click', () => handleViewButtonClick(true));

const viewBottomButton = document.getElementById('viewBottomButton');
viewBottomButton.addEventListener('click', () => handleViewButtonClick(false));

const moveToTopButton = document.getElementById('moveToTopButton');
moveToTopButton.addEventListener('click', moveToDeckTop);

const moveToBottomButton = document.getElementById('moveToBottomButton');
moveToBottomButton.addEventListener('click', () => {
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);
    socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', sCard.index);
});

const shuffleToDeckButton = document.getElementById('shuffleToDeckButton');
shuffleToDeckButton.addEventListener('click', shuffleIntoDeck);

const moveToBoard = document.getElementById('moveToBoard');
moveToBoard.addEventListener('click', () => {
    moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'board', 'board_html', sCard.index);
    socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'board', 'board_html', sCard.index);
});

const shuffleAllButton = document.getElementById('shuffleAllButton');
shuffleAllButton.addEventListener('click', () => {
    const viewCount = sCard.user === 'self' ? viewCards.count : oppViewCards.count;
    for (let i = 0; i < viewCount; i++){
        moveCard(sCard.user, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', 0);
        socket.emit('moveCard', roomId, sCard.oUser, sCard.locationAsString, sCard.containerId, 'deck', 'deck_html', 0);
    };
    const deckCount = sCard.user === 'self' ? deck.count : oppDeck.count;
    const indices = shuffleIndices(deckCount);
    shuffleContainer(sCard.user, 'deck', 'deck_html', indices);
    socket.emit('shuffleContainer', roomId, sCard.oUser, 'deck', 'deck_html', indices);
});

const discardAllButton = document.getElementById('discardAllButton');
discardAllButton.addEventListener('click', () => {
    const discardAmount = sCard.user === 'self' ? attachedCardPopup.count : oppAttachedCardPopup.count;
    socket.emit('discardAll', roomId, sCard.oUser, discardAmount);
    discardAll(sCard.user, discardAmount);
});


