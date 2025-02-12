import {
  oppContainerDocument,
  selfContainerDocument,
} from '../../front-end.js';

const zoneIds = ['lostZone', 'deck', 'discard', 'attachedCards', 'viewCards'];
const selfElements = zoneIds.map((zoneId) =>
  selfContainerDocument.getElementById(zoneId)
);
const oppElements = zoneIds.map((zoneId) =>
  oppContainerDocument.getElementById(zoneId)
);
const elements = [...selfElements, ...oppElements];
const stadiumElement = document.getElementById('stadium');
const boardButtonContainer = document.getElementById('boardButtonContainer');

// Function to check the display of the elements and update the z-index of stadiumElement
const checkDisplayAndUpdateZIndex = () => {
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].style.display === 'block') {
      stadiumElement.style.zIndex = '-1';
      boardButtonContainer.style.zIndex = '-1';
      return; // Exit the function if a element is displayed
    }
  }
  // If none of the elements are displayed, set the z-index to 0
  stadiumElement.style.zIndex = '0';
  boardButtonContainer.style.zIndex = '0';
};

export const initializeStadiumObserver = () => {
  // Create a MutationObserver instance
  const observer = new MutationObserver(checkDisplayAndUpdateZIndex);

  // Options for the observer (which mutations to observe)
  const config = { attributes: true, attributeFilter: ['style'] };

  // Start observing each element for configured mutations
  elements.forEach((element) => observer.observe(element, config));
};
