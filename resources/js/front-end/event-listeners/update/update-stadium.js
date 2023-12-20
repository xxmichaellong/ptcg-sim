import { attachedCardPopup_html, boardButtonContainer, deck_html, discard_html, lostzone_html, oppAttachedCardPopup_html, oppDeck_html, oppDiscard_html, oppLostzone_html, oppViewCards_html, stadium_html, viewCards_html } from '../../front-end.js';

const containers = [
    lostzone_html,
    deck_html,
    discard_html,
    oppLostzone_html,
    oppDeck_html,
    oppDiscard_html,
    attachedCardPopup_html,
    oppAttachedCardPopup_html,
    viewCards_html,
    oppViewCards_html,
];

// Function to check the display of the containers and update the z-index of stadium_html
const checkDisplayAndUpdateZIndex = () => {
    for (let i = 0; i < containers.length; i++) {
        if (containers[i].style.display === 'block') {
            stadium_html.style.zIndex = '-1';
            boardButtonContainer.style.zIndex = '-1';
            return;  // Exit the function if a container is displayed
        };
    };
    // If none of the containers are displayed, set the z-index to 0
    stadium_html.style.zIndex = '0';
    boardButtonContainer.style.zIndex = '0';
}

// Create a MutationObserver instance
const observer = new MutationObserver(checkDisplayAndUpdateZIndex);

// Options for the observer (which mutations to observe)
const config = { attributes: true, attributeFilter: ['style'] };

// Start observing each container for configured mutations
containers.forEach(container => observer.observe(container, config));
