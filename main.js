import { drawHand } from "./drawHand.js";
import { drawCard } from "./drawCard.js";

// Buttons

// Draw a Hand
const drawHandButton = document.getElementById('drawHandButton');
drawHandButton.addEventListener('click', drawHand);

// Draw a Card from Deck
const drawCardButton = document.getElementById('drawCardButton');
drawCardButton.addEventListener('click', drawCard);