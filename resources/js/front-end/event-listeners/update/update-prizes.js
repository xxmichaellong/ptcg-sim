// Import prizes_html and oppPrizes_html
import { prizes_html, oppPrizes_html } from "../../front-end.js";

// Function to adjust image size based on the number of images
const adjustImageSize = (container) => {
  const images = container.getElementsByTagName('img');
  const numImages = images.length;
  const classList = numImages <= 6 ? 'prizes-normal-size' : 'prizes-small-size';

  for (const img of images) {
    img.classList.remove('prizes-normal-size', 'prizes-small-size');
    img.classList.add(classList); // Use add() to add a class
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
observer.observe(prizes_html, observerConfig);
observer.observe(oppPrizes_html, observerConfig);