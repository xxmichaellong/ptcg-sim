import { makeCardObject } from "./makeCardObject.js";
import { deck } from "./initialization.js";
import { imageClick } from "./imageClick.js";
import { dragEnd, dragOver, dragStart } from "./drag.js";

// Function to make card objects and add it to the deck array, specifying the quantity of each card
export const addCard = (quantity, name, image) => {
    for (let i = 0; i < quantity; i++) {
      const card = makeCardObject(name, image);
      deck.cards.push(card);
      const imgElement = document.createElement('img');
      imgElement.src = card.image; // Set the src attribute to the image URL
      imgElement.alt = card.name; // Set the alt attribute (alternative text for the image)
      imgElement.addEventListener('click', imageClick); //Add a click event listener to the image
      imgElement.draggable = true; // Make image draggable
      imgElement.addEventListener('dragstart', dragStart); //Add a dragstart even listener
      imgElement.addEventListener('dragover', dragOver);
      imgElement.addEventListener('dragend', dragEnd);
      imgElement.style.zIndex = '0'; // You may adjust this value as needed
      deck.images.push(imgElement); // Add the image to a deck array so we can access it later=
    };
  }