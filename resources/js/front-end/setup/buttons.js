import {selectedCard, prizes_html, lostzone_html, discard_html, prizes, deck_html, hand, deck } from "./initialization.js";
import { drawHand } from "../general-actions/hand/draw-hand.js";
import { shuffleButtonFunction } from "../general-actions/shuffle-container.js";
import { revealCards, hideCards } from "../general-actions/reveal-and-hide-button.js"; 
import { selfContainersDocument } from "./initialization.js";
import { oppContainersDocument, oppDeck_html, oppDiscard_html, oppHand, oppHand_html, oppLostzone_html } from "./opp-initialization.js";
import { addDamageCounter } from "../general-actions/damage-counter.js";
import { variableToString } from "./string-to-variable.js";
import { socket } from "./socket.js";
import { addSpecialCondition } from "../general-actions/special-condition.js";
import { roomId, username } from "../start-page/generate-id.js";
import { discardAndDraw, draw, shuffleAndDraw, shuffleBottomAndDraw } from "../general-actions/hand/discard-and-draw.js";

// Draw a Hand
const drawHandButton = document.getElementById('drawHandButton');
drawHandButton.addEventListener('click', function(){drawHand('self')});

const shuffleDeckButton = document.getElementById('shuffleDeckButton');
const shufflePrizesButton = document.getElementById('shufflePrizesButton');

shuffleDeckButton.addEventListener('click', function(){shuffleButtonFunction ('self', 'deck', 'deck_html')});
shufflePrizesButton.addEventListener('click', function(){shuffleButtonFunction ('self', 'prizes', 'prizes_html')});

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
    addDamageCounter(selectedCard.user, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
    socket.emit('addDamageCounter', roomId, selectedCard.oUser, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
});

const specialConditionButton = document.getElementById('specialConditionButton');
specialConditionButton.addEventListener('click', function(){
    addSpecialCondition(selectedCard.user, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
    socket.emit('addSpecialCondition', roomId, selectedCard.oUser, variableToString(selectedCard.user, selectedCard.location), variableToString(selectedCard.user, selectedCard.container), selectedCard.index)
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
    chatbox.appendChild(p);
    chatbox.scrollTop = chatbox.scrollHeight;

    socket.emit('generalMessage', roomId, message);
});

const vSTARButton = document.getElementById('vSTARButton');
vSTARButton.addEventListener('click', () => {
    const p = document.createElement('p');
    p.className = 'announcement';
    p.style.backgroundColor = 'grey';
    p.textContent = username + ' used their VSTAR!';
    chatbox.appendChild(p);
    chatbox.scrollTop = chatbox.scrollHeight;

    socket.emit('generalMessage', roomId, p.textContent);
});

const discardHandButton = document.getElementById('discardHandButton');
discardHandButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Enter the draw amount:', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0) {
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

    const userInput = window.prompt('Enter the draw amount:', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0) {
        drawAmount = Math.min(drawAmount, (deck.count + hand.count));
        shuffleAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

const shuffleHandBottomButton = document.getElementById('shuffleHandBottomButton');
shuffleHandBottomButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Enter the draw amount:', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0) {
        drawAmount = Math.min(drawAmount, (deck.count + hand.count));
        shuffleBottomAndDraw('self', hand.count, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

const drawButton = document.getElementById('drawButton');
drawButton.addEventListener('click', () => {
    let drawAmount;

    const userInput = window.prompt('Enter the draw amount:', '0');

    drawAmount = parseInt(userInput);

    if (!isNaN(drawAmount) && drawAmount >= 0) {
        drawAmount = Math.min(drawAmount, deck.count);
        draw('self', drawAmount);
        socket.emit('draw', roomId, drawAmount);
    } else {
        window.alert('Please enter a valid number for the draw amount.');
    };
});

