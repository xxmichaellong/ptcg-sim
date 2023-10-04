import { makeCardObject } from "./makeCardObject.js";
import { deck } from "./initialization.js";
import { imageClick } from "./imageClick.js";

// Function to make card objects and add it to the deck array, specifying the quantity of each card
export const addCard = (quantity, name, image) => {
    for (let i = 0; i < quantity; i++) {
      const card = makeCardObject(name, image);
      deck.cards.push(card);
      const imgElement = document.createElement('img');
      // Set the src attribute to the image URL
      imgElement.src = card.image;
      // Set the alt attribute (alternative text for the image)
      imgElement.alt = card.name;
      //Add a click event listener to the image
      imgElement.addEventListener('click', imageClick);

      /* Append the <img> element to the container
      hand_html.appendChild(imgElement); */

      // Add the image to an array so we can access it later
      deck.images.push(imgElement);
    };
  }