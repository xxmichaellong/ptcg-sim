import { makeCardObject } from "./makeCardObject.js";
import { deck } from "./initialization.js";

// Function to make card objects and add it to the deck array, specifying the quantity of each card
export const addCard = (quantity, name, image) => {
    for (let i = 0; i < quantity; i++) {
      const card = makeCardObject(name, image);
      deck.cards.push(card);
    }
  };