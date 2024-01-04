// Import prizesElement and oppPrizesElement
import { prizesElement, oppPrizesElement } from "../../front-end.js";

// Function to adjust image size based on the number of images
const adjustImageSize = (element) => {
  const images = element.getElementsByTagName('img');
  const numImages = images.length;
  const classList = numImages <= 6 ? 'prizes-normal-size' : 'prizes-small-size';

  for (const image of images) {
    image.classList.remove('prizes-normal-size', 'prizes-small-size');
    image.classList.add(classList); // Use add() to add a class
  }
};

// Mutation Observer configuration
const observerConfig = { childList: true, subtree: true };

// Callback function for the Mutation Observer
const mutationCallback = (mutationsList, observer) => {
  for (const mutation of mutationsList) {
    if (mutation.type === 'childList') {
      // Child nodes have been added or removed, adjust image size
      adjustImageSize(mutation.target);
    }
  }
};

// Create a Mutation Observer with the specified callback and configuration
const observer = new MutationObserver(mutationCallback);

// Start observing the target nodes for configured mutations
observer.observe(prizesElement, observerConfig);
observer.observe(oppPrizesElement, observerConfig);