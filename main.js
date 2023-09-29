import { drawHand } from "./drawHand.js";
import { drawCard } from "./drawCard.js";
import { discardCard } from "./discardCard.js";

// Buttons

// Draw a Hand
const drawHandButton = document.getElementById('drawHandButton');
drawHandButton.addEventListener('click', drawHand);

// Draw a Card from Deck
const drawCardButton = document.getElementById('drawCardButton');
drawCardButton.addEventListener('click', drawCard);

// Discard a Card from Hand
const discardCardButton = document.getElementById('discardCardButton');
discardCardButton.addEventListener('click', discardCard);