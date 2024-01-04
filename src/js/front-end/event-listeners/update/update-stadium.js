import { attachedCardsElement, boardButtonsContainer, deckElement, discardElement, lostZoneElement, oppAttachedCardsElement, oppDeckElement, oppDiscardElement, oppLostZoneElement, oppViewCardsElement, stadiumElement, viewCardsElement } from '../../front-end.js';

const elements = [
    lostZoneElement,
    deckElement,
    discardElement,
    oppLostZoneElement,
    oppDeckElement,
    oppDiscardElement,
    attachedCardsElement,
    oppAttachedCardsElement,
    viewCardsElement,
    oppViewCardsElement,
];

// Function to check the display of the elements and update the z-index of stadiumElement
const checkDisplayAndUpdateZIndex = () => {
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].style.display === 'block') {
            stadiumElement.style.zIndex = '-1';
            boardButtonsContainer.style.zIndex = '-1';
            return;  // Exit the function if a element is displayed
        };
    };
    // If none of the elements are displayed, set the z-index to 0
    stadiumElement.style.zIndex = '0';
    boardButtonsContainer.style.zIndex = '0';
}

// Create a MutationObserver instance
const observer = new MutationObserver(checkDisplayAndUpdateZIndex);

// Options for the observer (which mutations to observe)
const config = { attributes: true, attributeFilter: ['style'] };

// Start observing each element for configured mutations
elements.forEach(element => observer.observe(element, config));
