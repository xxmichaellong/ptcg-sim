export * from './initialization/global-variables/global-variables.js'; // Initialize all globally accessible variables

import { initializeDOMEventListeners } from './initialization/document-event-listeners/initialize-document-event-listeners.js';
import { initializeMutationObservers } from './initialization/mutation-observers/initialize-mutation-observers.js';
import { initializeSocketEventListeners } from './initialization/socket-event-listeners/socket-event-listeners.js';
import { acceptAction } from './setup/general/accept-action.js';
import { refreshBoardImages } from './setup/sizing/refresh-board.js';

initializeSocketEventListeners(); // Initializes all event listeners for socket events
initializeDOMEventListeners(); // Initializes all event listeners for user's actions on html elements and the window
initializeMutationObservers(); // Initializes all mutation observers for user's actions on html elements

// Some hacky way to get the importData (if there is any), and load the content.
const importData = JSON.parse(document.getElementById('importDataJSON').textContent);
if (importData){
    importData.forEach(data => {
      acceptAction(data.user, data.action, data.parameters, true);
    });
    refreshBoardImages();
}